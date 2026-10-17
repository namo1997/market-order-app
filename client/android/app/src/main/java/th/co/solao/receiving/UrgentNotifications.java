package th.co.solao.receiving;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** Local urgent alerts only. The OS owns looping audio; no player/service/timer. */
public final class UrgentNotifications {
    public static final String CHANNEL_ID = "receiving_urgent_question003_v1";
    public static final String TAG = "receiving-urgent";
    public static final String ACTION = "th.co.solao.receiving.ACK_ALERT";
    public static final String EXTRA_ID = "receiving.alert.id";
    public static final String EXTRA_DATA = "receiving.alert.data";
    private UrgentNotifications() {}

    public static Uri sound(Context context) {
        // Stable resource name survives R8/resource id changes on app upgrades.
        return Uri.parse("android.resource://" + context.getPackageName() + "/raw/question_003");
    }

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "เรื่องด่วนรับสินค้า", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("ตามของและของเลยกำหนด ดังซ้ำจนแตะหรือรับทราบ");
            channel.setSound(sound(context), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[] { 0, 400, 200, 400 });
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            // Recreating an existing channel preserves the employee's OS settings.
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    public static boolean permitted(Context context) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = context.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL_ID);
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    public static Notification build(Context context, int id, String title, String body, String data) {
        Intent open = new Intent(context, MainActivity.class).setAction(ACTION)
            .setData(Uri.parse("solao-receiving://alert/" + id))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ID, id).putExtra(EXTRA_DATA, data);
        PendingIntent tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_receiving).setContentTitle(title).setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setSound(sound(context)).setVibrate(new long[] { 0, 400, 200, 400 })
            .setContentIntent(tap).addAction(0, "รับทราบ", tap)
            .setAutoCancel(true).setOngoing(true).build();
        notification.flags |= Notification.FLAG_INSISTENT;
        return notification;
    }

    public static void post(Context context, int id, String title, String body, String data) {
        ensureChannel(context);
        if (!permitted(context)) throw new SecurityException("Notifications disabled");
        context.getSystemService(NotificationManager.class).notify(TAG, id, build(context, id, title, body, data));
    }

    public static void cancel(Context context, int id) {
        context.getSystemService(NotificationManager.class).cancel(TAG, id);
    }

    public static void acknowledge(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        int id = intent.getIntExtra(EXTRA_ID, 0);
        if (id > 0) cancel(context, id);
        intent.removeExtra(EXTRA_ID);
    }
}
