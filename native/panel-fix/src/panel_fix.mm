#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <dispatch/dispatch.h>
#include <string>

static napi_env g_env = nullptr;
static napi_ref g_frontmost = nullptr, g_screens = nullptr, g_space = nullptr;
static id g_workspaceObserver = nil, g_screenObserver = nil, g_spaceObserver = nil;
static char g_unconstrainedMarker;
static IMP g_originalConstrainFrame = nullptr;

static napi_value String(napi_env env, NSString *value) { napi_value out; napi_create_string_utf8(env, value.UTF8String ?: "", NAPI_AUTO_LENGTH, &out); return out; }
static NSString *ArgString(napi_env env, napi_value value) {
  size_t n = 0; napi_get_value_string_utf8(env, value, nullptr, 0, &n); std::string s(n + 1, '\0'); napi_get_value_string_utf8(env, value, s.data(), s.size(), &n); return [NSString stringWithUTF8String:s.c_str()] ?: @"";
}
static napi_value Obj(napi_env env) { napi_value o; napi_create_object(env, &o); return o; }
static void Set(napi_env env, napi_value o, const char *key, napi_value v) { napi_set_named_property(env, o, key, v); }
static void Num(napi_env env, napi_value o, const char *key, double v) { napi_value n; napi_create_double(env, v, &n); Set(env, o, key, n); }
static void Bool(napi_env env, napi_value o, const char *key, bool v) { napi_value b; napi_get_boolean(env, v, &b); Set(env, o, key, b); }
static void Invoke(napi_ref ref, napi_value arg) {
  if (!g_env || !ref) return;
  napi_handle_scope scope;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return;
  napi_value fn, global, result; if (napi_get_reference_value(g_env, ref, &fn) != napi_ok) { napi_close_handle_scope(g_env, scope); return; }
  napi_get_global(g_env, &global); napi_call_function(g_env, global, fn, arg ? 1 : 0, arg ? &arg : nullptr, &result);
  napi_close_handle_scope(g_env, scope);
}
static NSScreen *ScreenForId(NSString *value) {
  CGDirectDisplayID wanted = (CGDirectDisplayID)value.longLongValue;
  for (NSScreen *screen in NSScreen.screens) if ((CGDirectDisplayID)[screen.deviceDescription[@"NSScreenNumber"] unsignedIntValue] == wanted) return screen;
  return NSScreen.mainScreen;
}
static NSRect UnconstrainedFrame(id self, SEL command, NSRect frame, NSScreen *screen) {
  if (objc_getAssociatedObject(self, &g_unconstrainedMarker)) return frame;
  return ((NSRect (*)(id, SEL, NSRect, NSScreen *))g_originalConstrainFrame)(self, command, frame, screen);
}
static void MakeWindowUnconstrained(NSWindow *window) {
  static Class patchedClass = Nil;
  Class windowClass = object_getClass(window);
  if (patchedClass != windowClass) {
    Method original = class_getInstanceMethod(windowClass, @selector(constrainFrameRect:toScreen:));
    g_originalConstrainFrame = method_getImplementation(original);
    const char *types = method_getTypeEncoding(original);
    class_replaceMethod(windowClass, @selector(constrainFrameRect:toScreen:), (IMP)UnconstrainedFrame, types);
    patchedClass = windowClass;
  }
  objc_setAssociatedObject(window, &g_unconstrainedMarker, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
static napi_value Screens(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value array; napi_create_array(env, &array); NSUInteger i = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSDictionary *desc = screen.deviceDescription; CGDirectDisplayID did = (CGDirectDisplayID)[desc[@"NSScreenNumber"] unsignedIntValue];
    NSRect frame = screen.frame, visible = screen.visibleFrame; NSEdgeInsets safe = screen.safeAreaInsets;
    NSRect leftArea = screen.auxiliaryTopLeftArea, rightArea = screen.auxiliaryTopRightArea;
    CGFloat left = NSIsEmptyRect(leftArea) ? 0 : NSMaxX(leftArea) - NSMinX(frame);
    CGFloat right = NSIsEmptyRect(rightArea) ? frame.size.width : NSMinX(rightArea) - NSMinX(frame);
    BOOL notch = safe.top > 0 && (left > 0 || right < frame.size.width);
    napi_value o = Obj(env); Num(env,o,"width",frame.size.width); Num(env,o,"height",frame.size.height); Num(env,o,"scaleFactor",screen.backingScaleFactor); Bool(env,o,"isMain", screen == NSScreen.mainScreen); Num(env,o,"cgDisplayId",did); Set(env,o,"localizedName",String(env, screen.localizedName)); Bool(env,o,"hasNotch",notch); Num(env,o,"notchHeight",notch ? safe.top : 0); Num(env,o,"notchWidth",notch ? frame.size.width - left - (frame.size.width-right) : 0); Num(env,o,"menuBarHeight",frame.size.height-visible.size.height); Num(env,o,"screenWidth",frame.size.width); Num(env,o,"screenHeight",frame.size.height); Num(env,o,"screenOriginX",frame.origin.x); Num(env,o,"screenOriginY",frame.origin.y); napi_set_element(env,array,(uint32_t)i++,o);
  }
  return array;
}
static napi_value NotchInfo(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t wanted = CGMainDisplayID();
  if (argc) {
    napi_valuetype type; napi_typeof(env, argv[0], &type);
    if (type == napi_number) napi_get_value_uint32(env, argv[0], &wanted);
    else wanted = (uint32_t)ArgString(env, argv[0]).longLongValue;
  }
  napi_value screens = Screens(env, nullptr); uint32_t length = 0; napi_get_array_length(env, screens, &length);
  for (uint32_t i = 0; i < length; i++) {
    napi_value screen, id; uint32_t display = 0;
    napi_get_element(env, screens, i, &screen); napi_get_named_property(env, screen, "cgDisplayId", &id); napi_get_value_uint32(env, id, &display);
    if (display == wanted) return screen;
  }
  return nullptr;
}
static NSWindow *WindowFromArg(napi_env env, napi_value value) { void *ptr = nullptr; size_t len = 0; if (napi_get_buffer_info(env,value,&ptr,&len)!=napi_ok || len < sizeof(void*)) return nil; NSView *view = (__bridge NSView *)*(void **)ptr; return view.window; }
static napi_value FixPanel(napi_env env, napi_callback_info info) {
  size_t argc=2; napi_value argv[2]; napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr); if(argc<2) return nullptr; NSWindow *window=WindowFromArg(env,argv[0]); if(!window) return nullptr; NSScreen *screen=ScreenForId(ArgString(env,argv[1])); MakeWindowUnconstrained(window); NSRect frame=window.frame; NSRect sf=screen.frame; frame.origin.x=NSMidX(sf)-frame.size.width/2; frame.origin.y=NSMaxY(sf)-frame.size.height; [window setFrame:frame display:NO]; [window setLevel:CGWindowLevelForKey(kCGOverlayWindowLevelKey)]; [window setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorFullScreenAuxiliary|NSWindowCollectionBehaviorStationary]; [window setHidesOnDeactivate:NO]; return nullptr;
}
static napi_value FixPet(napi_env env, napi_callback_info info) { size_t argc=1; napi_value arg; napi_get_cb_info(env,info,&argc,&arg,nullptr,nullptr); NSWindow *w=WindowFromArg(env,arg); if(w){[w setLevel:NSStatusWindowLevel]; [w setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorFullScreenAuxiliary];} return nullptr; }
static napi_value Haptic(napi_env env,napi_callback_info) { if(@available(macOS 10.11,*)) [[NSHapticFeedbackManager defaultPerformer] performFeedbackPattern:NSHapticFeedbackPatternAlignment performanceTime:NSHapticFeedbackPerformanceTimeNow]; return nullptr; }
static CGDirectDisplayID DisplayForFrontmostWindow(void) {
  NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!app) return 0;
  CFArrayRef raw = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
  NSArray *windows = CFBridgingRelease(raw);
  for (NSDictionary *window in windows) {
    if ([window[(NSString *)kCGWindowOwnerPID] intValue] != app.processIdentifier ||
        [window[(NSString *)kCGWindowLayer] intValue] != 0) continue;
    CGRect bounds;
    if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(NSString *)kCGWindowBounds], &bounds)) continue;
    uint32_t count = 0;
    CGDirectDisplayID displays[16];
    if (CGGetDisplaysWithRect(bounds, 16, displays, &count) == kCGErrorSuccess && count) return displays[0];
  }
  return CGMainDisplayID();
}
static napi_value FrontId(napi_env env,napi_callback_info) {
  CGDirectDisplayID display = DisplayForFrontmostWindow();
  if (!display) return nullptr;
  napi_value value; napi_create_uint32(env, display, &value); return value;
}
static void InvokeFrontmost(void) {
  if (!g_env || !g_frontmost) return;
  napi_handle_scope scope;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return;
  napi_value callback, global, result, display = FrontId(g_env, nullptr);
  if (napi_get_reference_value(g_env, g_frontmost, &callback) == napi_ok) {
    napi_get_global(g_env, &global);
    napi_call_function(g_env, global, callback, display ? 1 : 0, display ? &display : nullptr, &result);
  }
  napi_close_handle_scope(g_env, scope);
}
static napi_value Bundle(napi_env env,napi_callback_info) { NSRunningApplication *app=NSWorkspace.sharedWorkspace.frontmostApplication; return app.bundleIdentifier ? String(env,app.bundleIdentifier) : nullptr; }
static napi_value Fullscreen(napi_env env,napi_callback_info info) {
  napi_value argv[1]; size_t argc=1; napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr);
  CGDirectDisplayID display = argc ? (CGDirectDisplayID)ArgString(env, argv[0]).longLongValue : CGMainDisplayID();
  CGRect screen = CGDisplayBounds(display); BOOL fullscreen = NO;
  NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
  CFArrayRef raw = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
  NSArray *windows = CFBridgingRelease(raw);
  for (NSDictionary *window in windows) {
    if ([window[(NSString *)kCGWindowOwnerPID] intValue] != app.processIdentifier || [window[(NSString *)kCGWindowLayer] intValue] != 0) continue;
    CGRect bounds; if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(NSString *)kCGWindowBounds], &bounds)) continue;
    if (fabs(bounds.origin.x-screen.origin.x)<2 && fabs(bounds.origin.y-screen.origin.y)<2 && fabs(bounds.size.width-screen.size.width)<2 && fabs(bounds.size.height-screen.size.height)<2) { fullscreen=YES; break; }
  }
  napi_value o=Obj(env); Bool(env,o,"hasFullscreenApp",fullscreen); Bool(env,o,"menuBarVisible",[NSMenu menuBarVisible]); return o;
}
static napi_value Corner(napi_env env,napi_callback_info info) { size_t argc=2; napi_value a[2]; napi_get_cb_info(env,info,&argc,a,nullptr,nullptr); NSWindow *w=WindowFromArg(env,a[0]); double radius=0; napi_get_value_double(env,a[1],&radius); if(w){w.contentView.wantsLayer=YES; w.contentView.layer.cornerRadius=radius; w.contentView.layer.masksToBounds=YES;} return nullptr; }
static napi_value Watch(napi_env env,napi_callback_info info) { size_t argc=1; napi_value cb; napi_get_cb_info(env,info,&argc,&cb,nullptr,nullptr); if(argc<1) return nullptr; napi_ref *slot=&g_frontmost; if(*slot) napi_delete_reference(env,*slot); napi_create_reference(env,cb,1,slot); if(!g_workspaceObserver) g_workspaceObserver=[NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *n){ InvokeFrontmost(); }]; return nullptr; }
static napi_value Unwatch(napi_env env,napi_callback_info) { if(g_workspaceObserver){[NSWorkspace.sharedWorkspace.notificationCenter removeObserver:g_workspaceObserver];g_workspaceObserver=nil;} if(g_frontmost){napi_delete_reference(env,g_frontmost);g_frontmost=nullptr;} return nullptr; }
static napi_value WatchScreens(napi_env env,napi_callback_info info) { size_t argc=1; napi_value cb; napi_get_cb_info(env,info,&argc,&cb,nullptr,nullptr); if(argc){if(g_screens)napi_delete_reference(env,g_screens); napi_create_reference(env,cb,1,&g_screens);} if(!g_screenObserver) g_screenObserver=[NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidChangeScreenParametersNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *n){Invoke(g_screens,nullptr);}]; return nullptr; }
static napi_value UnwatchScreens(napi_env env,napi_callback_info){if(g_screenObserver){[NSNotificationCenter.defaultCenter removeObserver:g_screenObserver];g_screenObserver=nil;}if(g_screens){napi_delete_reference(env,g_screens);g_screens=nullptr;}return nullptr;}
static napi_value WatchSpace(napi_env env,napi_callback_info info){size_t argc=1;napi_value cb;napi_get_cb_info(env,info,&argc,&cb,nullptr,nullptr);if(argc){if(g_space)napi_delete_reference(env,g_space);napi_create_reference(env,cb,1,&g_space);}if(!g_spaceObserver)g_spaceObserver=[NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification*n){Invoke(g_space,nullptr);}];return nullptr;}
static napi_value UnwatchSpace(napi_env env,napi_callback_info){if(g_spaceObserver){[NSWorkspace.sharedWorkspace.notificationCenter removeObserver:g_spaceObserver];g_spaceObserver=nil;}if(g_space){napi_delete_reference(env,g_space);g_space=nullptr;}return nullptr;}
static napi_value Scheme(napi_env env,napi_callback_info info){size_t argc=1;napi_value a;napi_get_cb_info(env,info,&argc,&a,nullptr,nullptr);if(!argc){napi_value b;napi_get_boolean(env,false,&b);return b;}NSString*s=ArgString(env,a);BOOL ok=[[NSWorkspace sharedWorkspace] URLForApplicationToOpenURL:[NSURL URLWithString:[NSString stringWithFormat:@"%@://",s]]]!=nil;napi_value b;napi_get_boolean(env,ok,&b);return b;}
static void Cleanup(void *) {
  NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
  if (g_workspaceObserver) [workspace removeObserver:g_workspaceObserver];
  if (g_screenObserver) [NSNotificationCenter.defaultCenter removeObserver:g_screenObserver];
  if (g_spaceObserver) [workspace removeObserver:g_spaceObserver];
  g_workspaceObserver = g_screenObserver = g_spaceObserver = nil;
  g_env = nullptr; g_frontmost = g_screens = g_space = nullptr;
}
static napi_value Init(napi_env env,napi_value exports){g_env=env; napi_add_env_cleanup_hook(env,Cleanup,nullptr); napi_property_descriptor p[]={ {"fixPanel",0,FixPanel,0,0,0,napi_default,0},{"fixPetWindow",0,FixPet,0,0,0,napi_default,0},{"getNotchInfo",0,NotchInfo,0,0,0,napi_default,0},{"getAllScreensInfo",0,Screens,0,0,0,napi_default,0},{"getFrontmostAppDisplayId",0,FrontId,0,0,0,napi_default,0},{"getFrontmostAppBundleId",0,Bundle,0,0,0,napi_default,0},{"performHapticFeedback",0,Haptic,0,0,0,napi_default,0},{"hasURLSchemeHandler",0,Scheme,0,0,0,napi_default,0},{"getScreenFullscreenState",0,Fullscreen,0,0,0,napi_default,0},{"setWindowCornerRadius",0,Corner,0,0,0,napi_default,0},{"watchFrontmostApp",0,Watch,0,0,0,napi_default,0},{"unwatchFrontmostApp",0,Unwatch,0,0,0,napi_default,0},{"watchScreenParameters",0,WatchScreens,0,0,0,napi_default,0},{"unwatchScreenParameters",0,UnwatchScreens,0,0,0,napi_default,0},{"watchActiveSpace",0,WatchSpace,0,0,0,napi_default,0},{"unwatchActiveSpace",0,UnwatchSpace,0,0,0,napi_default,0} }; napi_define_properties(env,exports,sizeof(p)/sizeof(*p),p); return exports; }
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
