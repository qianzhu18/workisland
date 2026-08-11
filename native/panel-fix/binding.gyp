{
  "targets": [{
    "target_name": "panel_fix",
    "sources": ["src/panel_fix.mm"],
    "cflags_cc": ["-std=c++17", "-fobjc-arc"],
    "xcode_settings": {
      "MACOSX_DEPLOYMENT_TARGET": "14.0",
      "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
      "CLANG_ENABLE_OBJC_ARC": "YES"
    },
    "libraries": ["-framework AppKit", "-framework CoreGraphics", "-framework Foundation"]
  }]
}
