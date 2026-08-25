#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <dispatch/dispatch.h>
#include <string>

static napi_env g_env = nullptr;
static napi_ref g_frontmost = nullptr, g_screens = nullptr, g_space = nullptr, g_fileDrop = nullptr;
static id g_workspaceObserver = nil, g_screenObserver = nil, g_spaceObserver = nil;
static NSSharingServicePicker *g_sharePicker = nil;
static NSDictionary<NSString *, NSSharingService *> *g_shareServices = nil;
static char g_unconstrainedMarker;
static char g_fileDropViewMarker;
static IMP g_originalConstrainFrame = nullptr;

static napi_value String(napi_env env, NSString *value) { napi_value out; napi_create_string_utf8(env, value.UTF8String ?: "", NAPI_AUTO_LENGTH, &out); return out; }
static NSArray<NSString *> *FilePathsFromPasteboard(NSPasteboard *pasteboard) {
  NSArray<NSURL *> *urls = [pasteboard
    readObjectsForClasses:@[[NSURL class]]
    options:@{ NSPasteboardURLReadingFileURLsOnlyKey: @YES }] ?: @[];
  NSMutableArray<NSString *> *paths = [NSMutableArray arrayWithCapacity:urls.count];
  for (NSURL *url in urls) if (url.isFileURL && url.path.length) [paths addObject:url.path];
  return paths;
}
static void InvokeFileDrop(NSArray<NSString *> *paths, NSPoint location, CGFloat contentHeight) {
  if (!g_env || !g_fileDrop || paths.count == 0) return;
  napi_handle_scope scope;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return;
  napi_value array; napi_create_array_with_length(g_env, paths.count, &array);
  [paths enumerateObjectsUsingBlock:^(NSString *path, NSUInteger index, BOOL *) {
    napi_set_element(g_env, array, (uint32_t)index, String(g_env, path));
  }];
  napi_value payload; napi_create_object(g_env, &payload);
  napi_set_named_property(g_env, payload, "paths", array);
  napi_value x, y; napi_create_double(g_env, location.x, &x); napi_create_double(g_env, MAX(0, contentHeight - location.y), &y);
  napi_set_named_property(g_env, payload, "x", x); napi_set_named_property(g_env, payload, "y", y);
  napi_value callback, global, result;
  if (napi_get_reference_value(g_env, g_fileDrop, &callback) == napi_ok) {
    napi_get_global(g_env, &global);
    napi_call_function(g_env, global, callback, 1, &payload, &result);
  }
  napi_close_handle_scope(g_env, scope);
}

@interface WorkIslandFileDropView : NSView <NSDraggingDestination>
@end

@implementation WorkIslandFileDropView
- (BOOL)isOpaque { return NO; }
- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
  return FilePathsFromPasteboard(sender.draggingPasteboard).count > 0 ? NSDragOperationCopy : NSDragOperationNone;
}
- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
  return FilePathsFromPasteboard(sender.draggingPasteboard).count > 0 ? NSDragOperationCopy : NSDragOperationNone;
}
- (BOOL)prepareForDragOperation:(id<NSDraggingInfo>)sender {
  return FilePathsFromPasteboard(sender.draggingPasteboard).count > 0;
}
- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
  NSArray<NSString *> *paths = FilePathsFromPasteboard(sender.draggingPasteboard);
  if (paths.count == 0) return NO;
  NSPoint location = sender.draggingLocation;
  InvokeFileDrop(paths, location, self.bounds.size.height);
  return YES;
}
@end
static NSString *ArgString(napi_env env, napi_value value) {
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, value, &type) == napi_ok && type == napi_number) {
    double number = 0;
    if (napi_get_value_double(env, value, &number) == napi_ok) {
      return [NSString stringWithFormat:@"%.0f", number];
    }
  }
  size_t n = 0; napi_get_value_string_utf8(env, value, nullptr, 0, &n); std::string s(n + 1, '\0'); napi_get_value_string_utf8(env, value, s.data(), s.size(), &n); return [NSString stringWithUTF8String:s.c_str()] ?: @"";
}
static NSArray<NSString *> *PathsFromArg(napi_env env, napi_value value) {
  bool isArray = false; napi_is_array(env, value, &isArray);
  if (!isArray) return @[];
  uint32_t length = 0; napi_get_array_length(env, value, &length);
  NSMutableArray<NSString *> *paths = [NSMutableArray arrayWithCapacity:length];
  for (uint32_t i = 0; i < length; i++) {
    napi_value entry; napi_get_element(env, value, i, &entry);
    NSString *path = ArgString(env, entry);
    if (path.length && [[NSFileManager defaultManager] fileExistsAtPath:path]) [paths addObject:path];
  }
  return paths;
}
static NSArray<NSURL *> *FileURLsFromPaths(NSArray<NSString *> *paths) {
  NSMutableArray<NSURL *> *urls = [NSMutableArray arrayWithCapacity:paths.count];
  for (NSString *path in paths) if (path.length) [urls addObject:[NSURL fileURLWithPath:path]];
  return urls;
}
static NSString *ImageDataUrl(NSImage *image) {
  if (!image) return nil;
  NSData *tiff = image.TIFFRepresentation;
  if (!tiff) return nil;
  NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:tiff];
  NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  if (!png) return nil;
  return [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]];
}
static NSString *ThumbnailImageDataUrl(NSImage *image) {
  if (!image) return nil;
  NSSize size = NSMakeSize(32, 32);
  NSImage *thumbnail = [[NSImage alloc] initWithSize:size];
  [thumbnail lockFocus];
  [image drawInRect:NSMakeRect(0, 0, size.width, size.height)
           fromRect:NSZeroRect
          operation:NSCompositingOperationCopy
           fraction:1.0];
  [thumbnail unlockFocus];
  return ImageDataUrl(thumbnail);
}
static NSArray<NSSharingService *> *SharingServicesForItems(NSArray *items) {
  NSMutableArray<NSSharingService *> *services = [[NSSharingService sharingServicesForItems:items] mutableCopy] ?: [NSMutableArray array];
  NSArray<NSSharingServiceName> *essential = @[NSSharingServiceNameSendViaAirDrop, NSSharingServiceNameComposeEmail, NSSharingServiceNameComposeMessage, NSSharingServiceNameAddToSafariReadingList];
  for (NSSharingServiceName name in essential) {
    NSSharingService *service = [NSSharingService sharingServiceNamed:name];
    BOOL exists = service && [services indexOfObjectPassingTest:^BOOL(NSSharingService *entry, NSUInteger, BOOL *) { return [entry.title isEqualToString:service.title]; }] != NSNotFound;
    if (service && !exists) {
      [services addObject:service];
    }
  }
  return services;
}
struct ShareProviderWork {
  napi_env env;
  napi_async_work work;
  napi_deferred deferred;
  __strong NSArray<NSDictionary<NSString *, NSString *> *> *providers;
  __strong NSDictionary<NSString *, NSSharingService *> *services;
};
static void DiscoverShareProvidersExecute(napi_env, void *data) {
  ShareProviderWork *work = static_cast<ShareProviderWork *>(data);
  @autoreleasepool {
    NSArray *items = @[[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES], @"WorkIsland"];
    NSArray<NSSharingService *> *services = SharingServicesForItems(items);
    NSMutableArray<NSDictionary<NSString *, NSString *> *> *providers = [NSMutableArray array];
    NSMutableDictionary<NSString *, NSSharingService *> *serviceMap = [NSMutableDictionary dictionary];
    NSString *airDropTitle = [NSSharingService sharingServiceNamed:NSSharingServiceNameSendViaAirDrop].title ?: @"AirDrop";
    for (NSSharingService *service in services) {
      NSString *title = service.title;
      NSString *providerId = [title isEqualToString:airDropTitle] ? @"AirDrop" : title;
      if (!title.length || serviceMap[providerId]) continue;
      NSString *icon = ThumbnailImageDataUrl(service.image) ?: @"";
      NSDictionary *provider = @{ @"id": providerId, @"title": title, @"iconDataUrl": icon };
      if ([title isEqualToString:airDropTitle]) [providers insertObject:provider atIndex:0];
      else [providers addObject:provider];
      serviceMap[providerId] = service;
    }
    NSImage *systemImage = nil;
    if (@available(macOS 11.0, *)) systemImage = [NSImage imageWithSystemSymbolName:@"square.and.arrow.up" accessibilityDescription:@"系统分享菜单"];
    [providers addObject:@{ @"id": @"__system__", @"title": @"系统分享菜单", @"iconDataUrl": ThumbnailImageDataUrl(systemImage) ?: @"" }];
    work->providers = [providers copy];
    work->services = [serviceMap copy];
  }
}
static void DiscoverShareProvidersComplete(napi_env env, napi_status status, void *data) {
  ShareProviderWork *work = static_cast<ShareProviderWork *>(data);
  if (status != napi_ok) {
    napi_value error; napi_create_string_utf8(env, "Unable to discover sharing services", NAPI_AUTO_LENGTH, &error);
    napi_reject_deferred(env, work->deferred, error);
  } else {
    g_shareServices = work->services;
    napi_value result; napi_create_array_with_length(env, work->providers.count, &result);
    [work->providers enumerateObjectsUsingBlock:^(NSDictionary<NSString *, NSString *> *provider, NSUInteger index, BOOL *) {
      napi_value entry; napi_create_object(env, &entry);
      napi_set_named_property(env, entry, "id", String(env, provider[@"id"]));
      napi_set_named_property(env, entry, "title", String(env, provider[@"title"]));
      napi_set_named_property(env, entry, "iconDataUrl", String(env, provider[@"iconDataUrl"]));
      napi_set_element(env, result, (uint32_t)index, entry);
    }];
    napi_resolve_deferred(env, work->deferred, result);
  }
  napi_delete_async_work(env, work->work);
  delete work;
}
static napi_value GetShareProviders(napi_env env, napi_callback_info) {
  ShareProviderWork *work = new ShareProviderWork{env, nullptr, nullptr, nil, nil};
  napi_value promise, resourceName;
  napi_create_promise(env, &work->deferred, &promise);
  napi_create_string_utf8(env, "WorkIslandShareProviders", NAPI_AUTO_LENGTH, &resourceName);
  napi_create_async_work(env, nullptr, resourceName, DiscoverShareProvidersExecute, DiscoverShareProvidersComplete, work, &work->work);
  napi_queue_async_work(env, work->work);
  return promise;
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
    // visibleFrame also excludes the Dock. Only the gap between the top edges
    // is the menu bar; using frame.height - visible.height includes the Dock
    // and pushes the Island down on external displays.
    CGFloat menuBarHeight = MAX(0, NSMaxY(frame) - NSMaxY(visible));
    napi_value o = Obj(env); Num(env,o,"width",frame.size.width); Num(env,o,"height",frame.size.height); Num(env,o,"scaleFactor",screen.backingScaleFactor); Bool(env,o,"isMain", screen == NSScreen.mainScreen); Num(env,o,"cgDisplayId",did); Set(env,o,"localizedName",String(env, screen.localizedName)); Bool(env,o,"hasNotch",notch); Num(env,o,"notchHeight",notch ? safe.top : 0); Num(env,o,"notchWidth",notch ? frame.size.width - left - (frame.size.width-right) : 0); Num(env,o,"menuBarHeight",menuBarHeight); Num(env,o,"screenWidth",frame.size.width); Num(env,o,"screenHeight",frame.size.height); Num(env,o,"screenOriginX",frame.origin.x); Num(env,o,"screenOriginY",frame.origin.y); napi_set_element(env,array,(uint32_t)i++,o);
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
  size_t argc=2; napi_value argv[2]; napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr);
  if(argc<2) return nullptr;
  NSWindow *window=WindowFromArg(env,argv[0]);
  if(!window) return nullptr;
  NSScreen *screen=ScreenForId(ArgString(env,argv[1]));
  MakeWindowUnconstrained(window);
  NSRect frame=window.frame;
  NSRect sf=screen.frame;
  NSRect vf=screen.visibleFrame;
  NSEdgeInsets safe=screen.safeAreaInsets;
  frame.origin.x=NSMidX(sf)-frame.size.width/2;
  // ── 垂直定位 ──────────────────────────────────────────────────
  // 有刘海（safeAreaInsets.top > 0）：嵌入物理刘海，贴屏幕顶部。
  // 无刘海但有菜单栏（顶部 frame 与 visibleFrame 的间距 > 0）：
  //   窗口垂直居中对齐菜单栏高度，而不是压在菜单栏上或下移到下方。
  //   menuBarHeight = NSMaxY(sf) - NSMaxY(vf)。visibleFrame 还会扣除 Dock，
  //   因此不能使用 sf.height - vf.height，否则会把 Dock 高度也算进去。
  //   居中 y = 屏幕顶部 - menuBarHeight + (menuBarHeight - windowHeight)/2
  // 无刘海且无菜单栏（全屏应用，菜单栏自动隐藏）：贴屏幕顶部。
  BOOL hasNotch = safe.top > 0;
  CGFloat menuBarH = MAX(0, NSMaxY(sf) - NSMaxY(vf));
  if (hasNotch) {
    // 有刘海：嵌入物理刘海，贴屏幕顶部
    frame.origin.y = NSMaxY(sf) - frame.size.height;
  } else if (menuBarH > 0 && frame.size.height <= menuBarH + 1) {
    // 无刘海 + 菜单栏可见 + 收起态：窗口垂直居中对齐菜单栏高度
    // macOS 坐标系 y 轴朝上：菜单栏底部 = NSMaxY(sf) - menuBarH
    frame.origin.y = NSMaxY(sf) - menuBarH + (menuBarH - frame.size.height) / 2.0;
  } else {
    // 展开态（height > menuBarH）或无菜单栏（全屏）：
    // 窗口顶部对齐屏幕顶部，向下生长。展开时覆盖菜单栏区域（窗口 level 高于菜单栏），
    // 与刘海屏展开行为一致。
    frame.origin.y = NSMaxY(sf) - frame.size.height;
  }
  [window setFrame:frame display:NO];
  [window setLevel:CGWindowLevelForKey(kCGOverlayWindowLevelKey)];
  [window setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorFullScreenAuxiliary|NSWindowCollectionBehaviorStationary];
  [window setHidesOnDeactivate:NO];
  return nullptr;
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
static napi_value SetFileDropTarget(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) return nullptr;
  NSWindow *window = WindowFromArg(env, argv[0]);
  if (!window || !window.contentView) return nullptr;
  bool active = false; napi_get_value_bool(env, argv[1], &active);
  WorkIslandFileDropView *view = objc_getAssociatedObject(window, &g_fileDropViewMarker);
  if (!active) {
    [view removeFromSuperview];
    objc_setAssociatedObject(window, &g_fileDropViewMarker, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (g_fileDrop) { napi_delete_reference(env, g_fileDrop); g_fileDrop = nullptr; }
    return nullptr;
  }
  if (argc >= 3) {
    napi_valuetype type = napi_undefined; napi_typeof(env, argv[2], &type);
    if (type == napi_function) {
      if (g_fileDrop) napi_delete_reference(env, g_fileDrop);
      napi_create_reference(env, argv[2], 1, &g_fileDrop);
    }
  }
  if (!view) {
    view = [[WorkIslandFileDropView alloc] initWithFrame:window.contentView.bounds];
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [view registerForDraggedTypes:@[NSPasteboardTypeFileURL]];
    [window.contentView addSubview:view positioned:NSWindowAbove relativeTo:nil];
    objc_setAssociatedObject(window, &g_fileDropViewMarker, view, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  } else {
    view.frame = window.contentView.bounds;
  }
  return nullptr;
}
static napi_value Watch(napi_env env,napi_callback_info info) { size_t argc=1; napi_value cb; napi_get_cb_info(env,info,&argc,&cb,nullptr,nullptr); if(argc<1) return nullptr; napi_ref *slot=&g_frontmost; if(*slot) napi_delete_reference(env,*slot); napi_create_reference(env,cb,1,slot); if(!g_workspaceObserver) g_workspaceObserver=[NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *n){ InvokeFrontmost(); }]; return nullptr; }
static napi_value Unwatch(napi_env env,napi_callback_info) { if(g_workspaceObserver){[NSWorkspace.sharedWorkspace.notificationCenter removeObserver:g_workspaceObserver];g_workspaceObserver=nil;} if(g_frontmost){napi_delete_reference(env,g_frontmost);g_frontmost=nullptr;} return nullptr; }
static napi_value WatchScreens(napi_env env,napi_callback_info info) { size_t argc=1; napi_value cb; napi_get_cb_info(env,info,&argc,&cb,nullptr,nullptr); if(argc){if(g_screens)napi_delete_reference(env,g_screens); napi_create_reference(env,cb,1,&g_screens);} if(!g_screenObserver) g_screenObserver=[NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidChangeScreenParametersNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *n){Invoke(g_screens,nullptr);}]; return nullptr; }
static napi_value UnwatchScreens(napi_env env,napi_callback_info){if(g_screenObserver){[NSNotificationCenter.defaultCenter removeObserver:g_screenObserver];g_screenObserver=nil;}if(g_screens){napi_delete_reference(env,g_screens);g_screens=nullptr;}return nullptr;}
static napi_value WatchSpace(napi_env env,napi_callback_info info){size_t argc=1;napi_value cb;napi_get_cb_info(env,info,&argc,&cb,nullptr,nullptr);if(argc){if(g_space)napi_delete_reference(env,g_space);napi_create_reference(env,cb,1,&g_space);}if(!g_spaceObserver)g_spaceObserver=[NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification*n){Invoke(g_space,nullptr);}];return nullptr;}
static napi_value UnwatchSpace(napi_env env,napi_callback_info){if(g_spaceObserver){[NSWorkspace.sharedWorkspace.notificationCenter removeObserver:g_spaceObserver];g_spaceObserver=nil;}if(g_space){napi_delete_reference(env,g_space);g_space=nullptr;}return nullptr;}
static napi_value Scheme(napi_env env,napi_callback_info info){size_t argc=1;napi_value a;napi_get_cb_info(env,info,&argc,&a,nullptr,nullptr);if(!argc){napi_value b;napi_get_boolean(env,false,&b);return b;}NSString*s=ArgString(env,a);BOOL ok=[[NSWorkspace sharedWorkspace] URLForApplicationToOpenURL:[NSURL URLWithString:[NSString stringWithFormat:@"%@://",s]]]!=nil;napi_value b;napi_get_boolean(env,ok,&b);return b;}
static napi_value ReadPasteboardFileURLs(napi_env env, napi_callback_info) {
  NSArray<NSURL *> *urls = [[NSPasteboard generalPasteboard]
    readObjectsForClasses:@[[NSURL class]]
    options:@{ NSPasteboardURLReadingFileURLsOnlyKey: @YES }] ?: @[];
  napi_value result; napi_create_array_with_length(env, urls.count, &result);
  [urls enumerateObjectsUsingBlock:^(NSURL *url, NSUInteger index, BOOL *) {
    napi_set_element(env, result, (uint32_t)index, String(env, url.path ?: @""));
  }];
  return result;
}
static napi_value CopyFilesToPasteboard(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSArray<NSURL *> *urls = argc ? FileURLsFromPaths(PathsFromArg(env, argv[0])) : @[];
  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  BOOL ok = urls.count > 0;
  if (ok) { [pasteboard clearContents]; ok = [pasteboard writeObjects:urls]; }
  napi_value result; napi_get_boolean(env, ok, &result); return result;
}
static napi_value GetFileIconDataUrl(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSString *path = argc ? ArgString(env, argv[0]) : @"";
  if (!path.length || ![[NSFileManager defaultManager] fileExistsAtPath:path]) {
    napi_value value; napi_get_null(env, &value); return value;
  }
  NSImage *image = [[NSWorkspace sharedWorkspace] iconForFile:path];
  NSString *dataUrl = ImageDataUrl(image);
  if (!dataUrl.length) { napi_value value; napi_get_null(env, &value); return value; }
  return String(env, dataUrl);
}
static napi_value ShowFilesSharePicker(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSWindow *window = argc > 0 ? WindowFromArg(env, argv[0]) : nil;
  NSArray<NSURL *> *urls = argc > 1 ? FileURLsFromPaths(PathsFromArg(env, argv[1])) : @[];
  BOOL ok = window != nil && urls.count > 0;
  if (ok) {
    NSView *view = window.contentView;
    g_sharePicker = [[NSSharingServicePicker alloc] initWithItems:urls];
    NSRect anchor = NSMakeRect(NSMidX(view.bounds), NSMaxY(view.bounds) - 8, 1, 1);
    [window makeKeyAndOrderFront:nil];
    [g_sharePicker showRelativeToRect:anchor ofView:view preferredEdge:NSMinYEdge];
  }
  napi_value result; napi_get_boolean(env, ok, &result); return result;
}
static napi_value GetAirDropIconDataUrl(napi_env env, napi_callback_info) {
  NSSharingService *service = [NSSharingService sharingServiceNamed:NSSharingServiceNameSendViaAirDrop];
  NSImage *image = service.image;
  if (!image) {
    if (@available(macOS 11.0, *)) image = [NSImage imageWithSystemSymbolName:@"airdrop" accessibilityDescription:@"AirDrop"];
  }
  NSString *dataUrl = ImageDataUrl(image);
  if (!dataUrl.length) { napi_value value; napi_get_null(env, &value); return value; }
  return String(env, dataUrl);
}
static napi_value ShareFilesViaAirDrop(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSArray<NSURL *> *urls = argc ? FileURLsFromPaths(PathsFromArg(env, argv[0])) : @[];
  NSSharingService *service = [NSSharingService sharingServiceNamed:NSSharingServiceNameSendViaAirDrop];
  BOOL ok = service != nil && urls.count > 0 && [service canPerformWithItems:urls];
  if (ok) [service performWithItems:urls];
  napi_value result; napi_get_boolean(env, ok, &result); return result;
}
static napi_value ShareFilesViaProvider(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSArray<NSURL *> *urls = argc > 0 ? FileURLsFromPaths(PathsFromArg(env, argv[0])) : @[];
  NSString *providerId = argc > 1 ? ArgString(env, argv[1]) : @"";
  NSSharingService *service = providerId.length ? g_shareServices[providerId] : nil;
  if ((!service || ![service canPerformWithItems:urls]) && urls.count > 0) {
    NSSharingService *airDrop = [NSSharingService sharingServiceNamed:NSSharingServiceNameSendViaAirDrop];
    if ([providerId isEqualToString:@"AirDrop"] && [airDrop canPerformWithItems:urls]) service = airDrop;
    for (NSSharingService *candidate in SharingServicesForItems(urls)) {
      if ([candidate.title isEqualToString:providerId] && [candidate canPerformWithItems:urls]) { service = candidate; break; }
    }
  }
  BOOL ok = service != nil && urls.count > 0 && [service canPerformWithItems:urls];
  if (ok) [service performWithItems:urls];
  napi_value result; napi_get_boolean(env, ok, &result); return result;
}
static void Cleanup(void *) {
  NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
  if (g_workspaceObserver) [workspace removeObserver:g_workspaceObserver];
  if (g_screenObserver) [NSNotificationCenter.defaultCenter removeObserver:g_screenObserver];
  if (g_spaceObserver) [workspace removeObserver:g_spaceObserver];
  g_workspaceObserver = g_screenObserver = g_spaceObserver = nil;
  g_sharePicker = nil;
  g_shareServices = nil;
  if (g_fileDrop && g_env) napi_delete_reference(g_env, g_fileDrop);
  g_env = nullptr; g_frontmost = g_screens = g_space = g_fileDrop = nullptr;
}
static napi_value Init(napi_env env,napi_value exports){g_env=env; napi_add_env_cleanup_hook(env,Cleanup,nullptr); napi_property_descriptor p[]={ {"fixPanel",0,FixPanel,0,0,0,napi_default,0},{"fixPetWindow",0,FixPet,0,0,0,napi_default,0},{"getNotchInfo",0,NotchInfo,0,0,0,napi_default,0},{"getAllScreensInfo",0,Screens,0,0,0,napi_default,0},{"getFrontmostAppDisplayId",0,FrontId,0,0,0,napi_default,0},{"getFrontmostAppBundleId",0,Bundle,0,0,0,napi_default,0},{"performHapticFeedback",0,Haptic,0,0,0,napi_default,0},{"hasURLSchemeHandler",0,Scheme,0,0,0,napi_default,0},{"getScreenFullscreenState",0,Fullscreen,0,0,0,napi_default,0},{"setWindowCornerRadius",0,Corner,0,0,0,napi_default,0},{"setFileDropTarget",0,SetFileDropTarget,0,0,0,napi_default,0},{"readPasteboardFileURLs",0,ReadPasteboardFileURLs,0,0,0,napi_default,0},{"copyFilesToPasteboard",0,CopyFilesToPasteboard,0,0,0,napi_default,0},{"getFileIconDataUrl",0,GetFileIconDataUrl,0,0,0,napi_default,0},{"getShareProviders",0,GetShareProviders,0,0,0,napi_default,0},{"shareFilesViaProvider",0,ShareFilesViaProvider,0,0,0,napi_default,0},{"showFilesSharePicker",0,ShowFilesSharePicker,0,0,0,napi_default,0},{"getAirDropIconDataUrl",0,GetAirDropIconDataUrl,0,0,0,napi_default,0},{"shareFilesViaAirDrop",0,ShareFilesViaAirDrop,0,0,0,napi_default,0},{"watchFrontmostApp",0,Watch,0,0,0,napi_default,0},{"unwatchFrontmostApp",0,Unwatch,0,0,0,napi_default,0},{"watchScreenParameters",0,WatchScreens,0,0,0,napi_default,0},{"unwatchScreenParameters",0,UnwatchScreens,0,0,0,napi_default,0},{"watchActiveSpace",0,WatchSpace,0,0,0,napi_default,0},{"unwatchActiveSpace",0,UnwatchSpace,0,0,0,napi_default,0} }; napi_define_properties(env,exports,sizeof(p)/sizeof(*p),p); return exports; }
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
