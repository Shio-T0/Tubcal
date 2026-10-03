package com.tubcal.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.view.OrientationEventListener
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import java.net.HttpURLConnection
import java.net.URL

/**
 * The phone shell around Tubcal's phone UI (built from android/phone, served
 * by the embedded server on localhost). The web UI does the drawing; this class
 * does what a web page can't do for itself on a phone, through `window.TubcalAndroid`:
 * the system share sheet, opening links in their own apps, rotation for fullscreen
 * video, keeping the screen awake, haptics, status-bar icon colour, immersive mode,
 * and saving exported files. It also:
 *  - passes the system-bar insets in as CSS vars (--sa-top/bottom/left/right) so
 *    the app bar clears the status bar and the tab bar clears the gesture bar;
 *  - shrinks the WebView above the keyboard (and flags `html[data-kb]`), so bottom
 *    sheets and composers sit on top of it rather than under it;
 *  - routes Back through `window.tubcalBack()` first — it closes the top-most sheet,
 *    the open player, a search — and only then goes back a page, then home.
 */
class MainActivity : Activity() {

    private lateinit var container: FrameLayout
    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    // Latest system-bar insets in CSS px.
    private var saTop = 0
    private var saBottom = 0
    private var saLeft = 0
    private var saRight = 0
    private var keyboardUp = false

    // Rotation: a requested lock releases once the phone is physically turned to
    // match it — the way a video app hands rotation back after fullscreen.
    private var orientationListener: OrientationEventListener? = null
    private var lockedTo: String? = null

    // A file the page asked to save, held while the system "Save to…" picker is open.
    private var pendingSave: ByteArray? = null

    private val ink = 0xFF1C140D.toInt()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }

        // Boot (or reuse) the embedded Flask server + live-notification poller.
        val svc = Intent(this, TubcalService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)

        container = FrameLayout(this)
        container.setBackgroundColor(ink)
        setContentView(container)
        goEdgeToEdge()

        webView = WebView(this)
        webView.setBackgroundColor(ink)
        container.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        container.setOnApplyWindowInsetsListener { _, insets ->
            readInsets(insets)
            applyInsetsToWeb()
            insets
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false   // the player autoplays on open
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)                      // double-tap is a seek gesture, not a zoom
            builtInZoomControls = false
            displayZoomControls = false
            setSupportMultipleWindows(true)            // target=_blank → onCreateWindow → outside
            javaScriptCanOpenWindowsAutomatically = true
        }
        webView.addJavascriptInterface(Bridge(), "TubcalAndroid")
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                handler?.cancel()   // we only ever load http loopback; never bypass real SSL
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (isLocal(url)) return false
                openOutside(url)
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                applyInsetsToWeb()  // re-apply once the document exists
            }
        }
        webView.webChromeClient = ShellChromeClient()

        showSplash()
        waitForServerThenLoad()
    }

    override fun onDestroy() {
        orientationListener?.disable()
        super.onDestroy()
    }

    // ---- links ----

    private fun isLocal(uri: Uri): Boolean {
        val scheme = uri.scheme ?: return true
        if (scheme == "about" || scheme == "data" || scheme == "blob" || scheme == "javascript") return true
        val host = uri.host ?: return false
        return (scheme == "http" || scheme == "https") && (host == "127.0.0.1" || host == "localhost")
    }

    /** A link out of the app: YouTube, Reddit, Crunchyroll… open in their own app
     *  when one is installed (Android picks), else the browser. */
    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "No app can open that link", Toast.LENGTH_SHORT).show()
        }
    }

    // ---- edge-to-edge, insets, keyboard ----

    private fun goEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    private fun readInsets(insets: WindowInsets) {
        val d = resources.displayMetrics.density
        var imePx = 0
        if (Build.VERSION.SDK_INT >= 30) {
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val ime = insets.getInsets(WindowInsets.Type.ime())
            saTop = (bars.top / d).toInt()
            saLeft = (bars.left / d).toInt()
            saRight = (bars.right / d).toInt()
            saBottom = (bars.bottom / d).toInt()
            imePx = ime.bottom
        } else {
            @Suppress("DEPRECATION")
            run {
                saTop = (insets.systemWindowInsetTop / d).toInt()
                saLeft = (insets.systemWindowInsetLeft / d).toInt()
                saRight = (insets.systemWindowInsetRight / d).toInt()
                val bottom = insets.systemWindowInsetBottom
                // pre-30 reports the keyboard as a tall bottom inset
                if (bottom / d > 120) { imePx = bottom; saBottom = 0 } else saBottom = (bottom / d).toInt()
            }
        }
        // The keyboard: shrink the WebView to sit above it, so the page's own
        // bottom-anchored pieces (sheets, composers) land on top of the keyboard.
        keyboardUp = imePx > 0
        container.setPadding(0, 0, 0, if (keyboardUp) imePx else 0)
        if (keyboardUp) saBottom = 0
    }

    /** Push the insets into the page as CSS variables (one managed <style>), and
     *  mark the keyboard on <html data-kb>. Safe to call repeatedly. */
    private fun applyInsetsToWeb() {
        if (!this::webView.isInitialized) return
        val css = ":root{--sa-top:${saTop}px;--sa-bottom:${saBottom}px;--sa-left:${saLeft}px;--sa-right:${saRight}px;--kb:0px;}"
        val js =
            "(function(){var id='tubcal-insets';var e=document.getElementById(id);" +
                "if(!e){e=document.createElement('style');e.id=id;" +
                "(document.head||document.documentElement).appendChild(e);}" +
                "e.textContent=" + jsString(css) + ";" +
                "document.documentElement.dataset.kb=" + (if (keyboardUp) "'1'" else "'0'") + ";})();"
        webView.evaluateJavascript(js, null)
    }

    private fun jsString(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    // ---- boot ----

    /** A warm splash in the app's own colours while the server starts (a first
     *  launch unpacks Python and the UI, which takes a few seconds). */
    private fun showSplash() {
        webView.loadDataWithBaseURL(
            null,
            "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>" +
                "<body style='margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;" +
                "justify-content:center;gap:14px;background:#1c140d;color:#e8d9b8;font-family:serif'>" +
                "<div style='font-size:38px;letter-spacing:-.02em'>Tub<i style='color:#e6ab5e'>cal</i></div>" +
                "<div style='font:12px monospace;letter-spacing:.18em;text-transform:uppercase;color:#a8977a'>" +
                "warming up the set…</div></body></html>",
            "text/html", "utf-8", null,
        )
    }

    private fun waitForServerThenLoad() {
        Thread {
            val deadline = System.currentTimeMillis() + 90_000
            var up = false
            while (System.currentTimeMillis() < deadline) {
                if (ping("${TubcalService.BASE_URL}/api/health")) { up = true; break }
                try { Thread.sleep(400) } catch (_: InterruptedException) { break }
            }
            runOnUiThread {
                if (up) {
                    if (!openRoute(intent)) webView.loadUrl(TubcalService.BASE_URL)
                    pageReady = true
                } else {
                    webView.loadDataWithBaseURL(
                        null,
                        "<body style='font-family:sans-serif;padding:24px;background:#1c140d;color:#e8d9b8'>" +
                            "<h2>Tubcal is still starting</h2><p>The embedded server didn't answer in time. " +
                            "Close the app and open it again.</p></body>",
                        "text/html", "utf-8", null,
                    )
                }
            }
        }.apply { isDaemon = true }.start()
    }

    private fun ping(url: String): Boolean = try {
        val c = (URL(url).openConnection() as HttpURLConnection)
        c.connectTimeout = 1000; c.readTimeout = 2000
        val ok = c.responseCode in 200..299
        c.disconnect(); ok
    } catch (_: Throwable) { false }

    // ---- Back ----

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (customView != null) { hideCustomView(); return }
        if (!this::webView.isInitialized) {
            @Suppress("DEPRECATION")
            super.onBackPressed()
            return
        }
        // The page closes its top-most thing first (a sheet, the player, a search).
        webView.evaluateJavascript("(window.tubcalBack ? window.tubcalBack() : 'unhandled')") { res ->
            if (res == "\"handled\"") return@evaluateJavascript
            if (webView.canGoBack()) webView.goBack()
            else moveTaskToBack(true)   // leave like Home: the server and any audio keep running
        }
    }

    // ---- rotation ----

    private fun requestRotation(mode: String) {
        lockedTo = null
        requestedOrientation = when (mode) {
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        if (mode == "landscape" || mode == "portrait") {
            lockedTo = mode
            ensureOrientationListener()
        }
    }

    /** Release a requested lock once the phone is actually held that way, so
     *  turning it afterwards rotates again (and the player follows). */
    private fun ensureOrientationListener() {
        if (orientationListener == null) {
            orientationListener = object : OrientationEventListener(this) {
                override fun onOrientationChanged(deg: Int) {
                    val want = lockedTo ?: return
                    if (deg == ORIENTATION_UNKNOWN) return
                    val portrait = deg <= 20 || deg >= 340 || deg in 160..200
                    val landscape = deg in 70..110 || deg in 250..290
                    if ((want == "portrait" && portrait) || (want == "landscape" && landscape)) {
                        lockedTo = null
                        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                        disable()
                    }
                }
            }
        }
        orientationListener?.takeIf { it.canDetectOrientation() }?.enable()
    }

    // ---- system bars ----

    private fun setLightBars(light: Boolean) {
        if (Build.VERSION.SDK_INT >= 30) {
            val flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (light) flags else 0, flags)
        } else {
            @Suppress("DEPRECATION")
            run {
                var v = window.decorView.systemUiVisibility
                val f = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                v = if (light) v or f else v and f.inv()
                window.decorView.systemUiVisibility = v
            }
        }
    }

    private fun hideSystemBars(on: Boolean) {
        if (Build.VERSION.SDK_INT >= 30) {
            val c = window.insetsController ?: return
            if (on) {
                c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                c.hide(WindowInsets.Type.systemBars())
            } else {
                c.show(WindowInsets.Type.systemBars())
            }
        } else {
            @Suppress("DEPRECATION")
            run {
                val base = View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                window.decorView.systemUiVisibility = if (on) base or
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                else base
            }
        }
    }

    // ---- saving files ----

    private fun saveFile(name: String, mime: String, bytes: ByteArray) {
        pendingSave = bytes
        val i = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime.ifBlank { "application/octet-stream" })
            .putExtra(Intent.EXTRA_TITLE, name)
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(i, REQ_SAVE)
        } catch (_: ActivityNotFoundException) {
            pendingSave = null
            Toast.makeText(this, "No app to save files with", Toast.LENGTH_SHORT).show()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_SAVE) return
        val bytes = pendingSave
        pendingSave = null
        val uri = data?.data
        if (resultCode != RESULT_OK || bytes == null || uri == null) return
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Couldn't save: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    // ---- the page's bridge ----

    /** `window.TubcalAndroid` — called on the WebView's JS thread; UI work hops to
     *  the main thread. Nothing here reaches beyond this app. */
    private inner class Bridge {
        @JavascriptInterface
        fun share(title: String?, url: String?, text: String?) = runOnUiThread {
            val body = listOf(text, url).filter { !it.isNullOrBlank() }.joinToString("\n")
            val send = Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, title ?: "")
                .putExtra(Intent.EXTRA_TEXT, body.ifBlank { title ?: "" })
            startActivity(Intent.createChooser(send, title?.takeIf { it.isNotBlank() } ?: "Share"))
        }

        @JavascriptInterface
        fun openExternal(url: String?) {
            val u = url?.let { Uri.parse(it) } ?: return
            runOnUiThread { openOutside(u) }
        }

        @JavascriptInterface
        fun setOrientation(mode: String?) = runOnUiThread { requestRotation(mode ?: "auto") }

        @JavascriptInterface
        fun keepScreenOn(on: Boolean) = runOnUiThread {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        @JavascriptInterface
        fun haptic(kind: String?) = runOnUiThread {
            val c = when (kind) {
                "press" -> HapticFeedbackConstants.LONG_PRESS
                "done" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
                else -> HapticFeedbackConstants.CLOCK_TICK
            }
            webView.performHapticFeedback(c)
        }

        @JavascriptInterface
        fun setLightBars(light: Boolean) = runOnUiThread { this@MainActivity.setLightBars(light) }

        @JavascriptInterface
        fun setImmersive(on: Boolean) = runOnUiThread { hideSystemBars(on) }

        @JavascriptInterface
        fun saveFile(name: String?, mime: String?, base64: String?) {
            val data = base64 ?: return
            val bytes = try { Base64.decode(data, Base64.DEFAULT) } catch (_: Exception) { return }
            runOnUiThread { this@MainActivity.saveFile(name ?: "tubcal-download", mime ?: "", bytes) }
        }

        @JavascriptInterface
        fun version(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (_: Exception) { "" }
    }

    // ---- fullscreen <video> (element.requestFullscreen) and new windows ----

    private inner class ShellChromeClient : WebChromeClient() {
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) { callback.onCustomViewHidden(); return }
            customView = view
            customViewCallback = callback
            webView.visibility = View.GONE
            container.addView(
                view,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
            )
            hideSystemBars(true)
        }

        override fun onHideCustomView() = hideCustomView()

        /** window.open / target=_blank: catch the first URL the new window would
         *  load and hand it to the right app instead. */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val probe = WebView(this@MainActivity)
            probe.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (isLocal(url)) webView.loadUrl(url.toString()) else openOutside(url)
                    v.destroy()
                    return true
                }
            }
            val transport = resultMsg.obj as WebView.WebViewTransport
            transport.webView = probe
            resultMsg.sendToTarget()
            return true
        }
    }

    private fun hideCustomView() {
        val view = customView ?: return
        container.removeView(view)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        webView.visibility = View.VISIBLE
        hideSystemBars(false)
    }

    // ---- deep links (a notification opens a route) ----

    private var pageReady = false

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openRoute(intent)
    }

    /** Navigate the page to the intent's route: in place when the app is up (no
     *  reload, the player keeps playing), else as the first load. */
    private fun openRoute(intent: Intent?): Boolean {
        val path = intent?.getStringExtra(EXTRA_PATH)?.takeIf { it.startsWith("/") } ?: return false
        intent.removeExtra(EXTRA_PATH)
        if (pageReady) {
            webView.evaluateJavascript(
                "(window.tubcalNavigate ? (window.tubcalNavigate(" + jsString(path) + "), 'ok') : 'no')",
            ) { res -> if (res != "\"ok\"") webView.loadUrl(TubcalService.BASE_URL + path) }
        } else {
            webView.loadUrl(TubcalService.BASE_URL + path)
        }
        return true
    }

    companion object {
        private const val REQ_SAVE = 41
        const val EXTRA_PATH = "com.tubcal.app.PATH"
    }
}
