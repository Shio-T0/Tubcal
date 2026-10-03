package com.tubcal.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Foreground service that hosts the embedded Tubcal Flask server (via Chaquopy)
 * and, separately, polls /api/youtube/live to fire a notification ~10 minutes
 * before a subscribed channel goes live — the Android equivalent of the desktop
 * build's notify-send notifier.
 */
class TubcalService : Service() {

    companion object {
        const val PORT = 8137
        const val BASE_URL = "http://127.0.0.1:$PORT"
        private const val CH_RUNNING = "tubcal_running"
        private const val CH_LIVE = "tubcal_live"
        private const val ONGOING_ID = 1
        private const val LEAD_SECONDS = 600L   // notify 10 minutes before
        private const val POLL_MS = 90_000L
    }

    @Volatile private var started = false
    private val notified = HashSet<String>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!started) {
            started = true
            createChannels()
            startForeground(ONGOING_ID, ongoingNotification())
            bootServerAsync()
            startLivePollerAsync()
        }
        return START_STICKY
    }

    // ---- embedded Python server ----

    private fun bootServerAsync() {
        Thread {
            try {
                val webDir = copyWebAssets()
                val dataDir = File(filesDir, "data").apply { mkdirs() }.absolutePath
                if (!Python.isStarted()) Python.start(AndroidPlatform(this))
                // start() runs Flask and blocks, so this thread *is* the server.
                Python.getInstance()
                    .getModule("android_main")
                    .callAttr("start", dataDir, webDir, PORT)
            } catch (e: Throwable) {
                e.printStackTrace()
            }
        }.apply { isDaemon = true; name = "tubcal-server" }.start()
    }

    /** Copy bundled frontend (assets/web) to a real dir Flask can send_from_directory. */
    private fun copyWebAssets(): String {
        val dest = File(filesDir, "web")
        val stamp = File(dest, ".version")
        // Version + install time: any reinstall re-extracts, even at the same
        // versionCode (a dev build that only changed the UI).
        val current = packageManager.getPackageInfo(packageName, 0).let {
            val code = if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toString() else @Suppress("DEPRECATION") it.versionCode.toString()
            "$code-${it.lastUpdateTime}"
        }
        if (dest.isDirectory && stamp.isFile && stamp.readText() == current) return dest.absolutePath
        dest.deleteRecursively()
        copyAssetTree("web", dest)
        stamp.parentFile?.mkdirs()
        stamp.writeText(current)
        return dest.absolutePath
    }

    private fun copyAssetTree(path: String, dest: File) {
        val children = assets.list(path) ?: emptyArray()
        if (children.isEmpty()) {                       // leaf = a file
            dest.parentFile?.mkdirs()
            assets.open(path).use { input -> dest.outputStream().use { input.copyTo(it) } }
            return
        }
        dest.mkdirs()
        for (child in children) copyAssetTree("$path/$child", File(dest, child))
    }

    // ---- live notifications ----

    private fun startLivePollerAsync() {
        Thread {
            Thread.sleep(15_000)                        // let the server come up
            while (true) {
                try { pollLive() } catch (_: Throwable) {}
                try { Thread.sleep(POLL_MS) } catch (_: InterruptedException) { break }
            }
        }.apply { isDaemon = true; name = "tubcal-live-poller" }.start()
    }

    private fun pollLive() {
        val body = httpGet("$BASE_URL/api/youtube/live") ?: return
        val root = JSONObject(body)
        if (!root.optBoolean("ok", false)) return
        val items = root.optJSONObject("data")?.optJSONArray("items") ?: return
        val now = System.currentTimeMillis() / 1000
        val stillUpcoming = HashSet<String>()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            val extra = item.optJSONObject("extra") ?: continue
            if (extra.optString("live_status") != "is_upcoming") continue
            val vid = extra.optString("video_id")
            if (vid.isEmpty()) continue
            stillUpcoming.add(vid)
            val sched = extra.optLong("scheduled_at", 0L)
            if (vid !in notified && sched in (now + 1)..(now + LEAD_SECONDS)) {
                postLiveNotification(item)
                notified.add(vid)
            }
        }
        notified.retainAll(stillUpcoming)               // let a rescheduled stream ping again
    }

    private fun postLiveNotification(item: JSONObject) {
        val title = item.optString("title")
        val source = item.optString("source").ifEmpty { "A channel" }
        val n = NotificationCompat.Builder(this, CH_LIVE)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Going live soon")
            .setContentText("$source goes live in ~10 min: $title")
            .setStyle(NotificationCompat.BigTextStyle().bigText("$source goes live in ~10 min:\n$title"))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent("/youtube?v=live", item.optString("id").hashCode()))
            .build()
        nm().notify(item.optString("id").hashCode(), n)
    }

    // ---- notifications plumbing ----

    private fun ongoingNotification(): Notification =
        NotificationCompat.Builder(this, CH_RUNNING)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Tubcal is running")
            .setContentText("Your private feed server is active.")
            .setOngoing(true)
            .setContentIntent(openAppIntent())
            .build()

    /** Open the app — on `path` (a phone-UI route) when given. */
    private fun openAppIntent(path: String? = null, requestCode: Int = 0): PendingIntent = PendingIntent.getActivity(
        this, requestCode,
        Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .apply { if (path != null) putExtra(MainActivity.EXTRA_PATH, path) },
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        nm().apply {
            createNotificationChannel(
                NotificationChannel(CH_RUNNING, "Server", NotificationManager.IMPORTANCE_LOW))
            createNotificationChannel(
                NotificationChannel(CH_LIVE, "Live alerts", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    private fun nm() = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun httpGet(url: String): String? {
        val c = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000; readTimeout = 120000
        }
        return try {
            if (c.responseCode in 200..299) c.inputStream.bufferedReader().readText() else null
        } finally { c.disconnect() }
    }
}
