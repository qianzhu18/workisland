#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <dlfcn.h>

typedef void (*RegisterNotificationsFn)(dispatch_queue_t);
typedef void (*GetNowPlayingInfoFn)(dispatch_queue_t, void (^)(CFDictionaryRef));
typedef void (*GetIsPlayingFn)(dispatch_queue_t, void (^)(Boolean));
typedef void (*GetApplicationPIDFn)(dispatch_queue_t, void (^)(int));
typedef void (*SendCommandFn)(NSInteger, id);
typedef void (*SetElapsedTimeFn)(double);

static void *framework = nullptr;
static RegisterNotificationsFn registerNotifications = nullptr;
static GetNowPlayingInfoFn getNowPlayingInfo = nullptr;
static GetIsPlayingFn getIsPlaying = nullptr;
static GetApplicationPIDFn getApplicationPID = nullptr;
static SendCommandFn sendCommand = nullptr;
static SetElapsedTimeFn setElapsedTime = nullptr;
static BOOL playing = NO;
static int sourcePID = 0;

static id symbolValue(const char *name) {
  void *address = dlsym(framework, name);
  return address ? (__bridge id)(*(CFTypeRef *)address) : nil;
}

static id valueForSymbol(NSDictionary *info, const char *name) {
  id key = symbolValue(name);
  return key ? info[key] : nil;
}

static void emitJSON(NSDictionary *payload) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (!data || error) return;
  NSMutableData *line = [data mutableCopy];
  [line appendBytes:"\n" length:1];
  [[NSFileHandle fileHandleWithStandardOutput] writeData:line];
}

static NSString *dataURL(NSData *data, NSString *mime) {
  if (![data isKindOfClass:NSData.class] || data.length == 0 || data.length > 6 * 1024 * 1024) return @"";
  NSString *type = [mime isKindOfClass:NSString.class] && [mime hasPrefix:@"image/"] ? mime : @"image/jpeg";
  return [NSString stringWithFormat:@"data:%@;base64,%@", type, [data base64EncodedStringWithOptions:0]];
}

static void publishState(void) {
  if (!getNowPlayingInfo) return;
  getNowPlayingInfo(dispatch_get_main_queue(), ^(CFDictionaryRef raw) {
    NSDictionary *info = CFBridgingRelease(raw ? CFRetain(raw) : nullptr) ?: @{};
    NSString *title = valueForSymbol(info, "kMRMediaRemoteNowPlayingInfoTitle") ?: @"";
    NSString *artist = valueForSymbol(info, "kMRMediaRemoteNowPlayingInfoArtist") ?: @"";
    NSString *album = valueForSymbol(info, "kMRMediaRemoteNowPlayingInfoAlbum") ?: @"";
    NSNumber *duration = valueForSymbol(info, "kMRMediaRemoteNowPlayingInfoDuration") ?: @0;
    NSNumber *elapsed = valueForSymbol(info, "kMRMediaRemoteNowPlayingInfoElapsedTime") ?: @0;
    NSNumber *rate = valueForSymbol(info, "kMRMediaRemoteNowPlayingInfoPlaybackRate") ?: @(playing ? 1 : 0);
    NSData *artwork = valueForSymbol(info, "kMRMediaRemoteNowPlayingInfoArtworkData");
    NSString *mime = valueForSymbol(info, "kMRMediaRemoteNowPlayingInfoArtworkMIMEType");
    NSRunningApplication *app = sourcePID > 0 ? [NSRunningApplication runningApplicationWithProcessIdentifier:sourcePID] : nil;
    BOOL active = title.length > 0 || artist.length > 0 || duration.doubleValue > 0 || sourcePID > 0;
    emitJSON(@{
      @"kind": @"state",
      @"state": @{
        @"active": @(active), @"playing": @(playing), @"title": title, @"artist": artist,
        @"album": album, @"durationSec": duration, @"elapsedSec": elapsed,
        @"playbackRate": rate, @"appBundleId": app.bundleIdentifier ?: @"",
        @"appName": app.localizedName ?: @"", @"artworkDataUrl": dataURL(artwork, mime),
        @"capabilities": @{ @"playPause": @YES, @"next": @YES, @"previous": @YES },
        @"updatedAt": @((long long)(NSDate.date.timeIntervalSince1970 * 1000))
      }
    });
  });
}

static void refresh(void) {
  dispatch_group_t group = dispatch_group_create();
  if (getIsPlaying) {
    dispatch_group_enter(group);
    getIsPlaying(dispatch_get_main_queue(), ^(Boolean value) { playing = value; dispatch_group_leave(group); });
  }
  if (getApplicationPID) {
    dispatch_group_enter(group);
    getApplicationPID(dispatch_get_main_queue(), ^(int pid) { sourcePID = pid; dispatch_group_leave(group); });
  }
  dispatch_group_notify(group, dispatch_get_main_queue(), ^{ publishState(); });
}

static BOOL loadFramework(void) {
  framework = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_LAZY);
  if (!framework) return NO;
  registerNotifications = (RegisterNotificationsFn)dlsym(framework, "MRMediaRemoteRegisterForNowPlayingNotifications");
  getNowPlayingInfo = (GetNowPlayingInfoFn)dlsym(framework, "MRMediaRemoteGetNowPlayingInfo");
  getIsPlaying = (GetIsPlayingFn)dlsym(framework, "MRMediaRemoteGetNowPlayingApplicationIsPlaying");
  getApplicationPID = (GetApplicationPIDFn)dlsym(framework, "MRMediaRemoteGetNowPlayingApplicationPID");
  sendCommand = (SendCommandFn)dlsym(framework, "MRMediaRemoteSendCommand");
  setElapsedTime = (SetElapsedTimeFn)dlsym(framework, "MRMediaRemoteSetElapsedTime");
  return registerNotifications && getNowPlayingInfo && getIsPlaying && sendCommand;
}

static void handleCommand(NSDictionary *payload) {
  NSString *command = payload[@"command"];
  if ([command isEqualToString:@"play"]) sendCommand(0, nil);
  else if ([command isEqualToString:@"pause"]) sendCommand(1, nil);
  else if ([command isEqualToString:@"toggle"]) sendCommand(2, nil);
  else if ([command isEqualToString:@"next"]) sendCommand(4, nil);
  else if ([command isEqualToString:@"previous"]) sendCommand(5, nil);
  else if ([command isEqualToString:@"seek"] && setElapsedTime) setElapsedTime([payload[@"positionSec"] doubleValue]);
  else if ([command isEqualToString:@"openSource"] && sourcePID > 0) {
    [[NSRunningApplication runningApplicationWithProcessIdentifier:sourcePID] activateWithOptions:0];
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ refresh(); });
}

static void readCommands(void) {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    NSFileHandle *input = NSFileHandle.fileHandleWithStandardInput;
    NSMutableData *buffer = [NSMutableData data];
    while (true) {
      NSData *chunk = input.availableData;
      if (chunk.length == 0) break;
      [buffer appendData:chunk];
      while (true) {
        const void *bytes = buffer.bytes;
        const void *newline = memchr(bytes, '\n', buffer.length);
        if (!newline) break;
        NSUInteger length = (const uint8_t *)newline - (const uint8_t *)bytes;
        NSData *line = [buffer subdataWithRange:NSMakeRange(0, length)];
        [buffer replaceBytesInRange:NSMakeRange(0, length + 1) withBytes:nullptr length:0];
        NSDictionary *payload = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
        if ([payload isKindOfClass:NSDictionary.class]) dispatch_async(dispatch_get_main_queue(), ^{ handleCommand(payload); });
      }
    }
  });
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    BOOL available = loadFramework();
    if (argc > 1 && strcmp(argv[1], "--probe") == 0) {
      emitJSON(@{ @"kind": available ? @"available" : @"unavailable" });
      return 0;
    }
    if (!available) {
      emitJSON(@{ @"kind": @"unavailable", @"reason": @"mediaremote-symbols-missing" });
      return 0;
    }
    registerNotifications(dispatch_get_main_queue());
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    const char *notificationSymbols[] = {
      "kMRMediaRemoteNowPlayingInfoDidChangeNotification",
      "kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification",
      "kMRMediaRemoteNowPlayingApplicationDidChangeNotification"
    };
    for (const char *symbol : notificationSymbols) {
      NSString *name = symbolValue(symbol);
      if (name) [center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) { refresh(); }];
    }
    readCommands();
    refresh();
    [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(__unused NSTimer *timer) { if (playing) refresh(); }];
    [NSRunLoop.mainRunLoop run];
  }
  return 0;
}
