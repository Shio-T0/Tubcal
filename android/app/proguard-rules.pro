# Chaquopy and the WebView shell don't need extra keep rules for a non-minified
# build. If you enable minification, keep Chaquopy's runtime:
# -keep class com.chaquo.python.** { *; }
