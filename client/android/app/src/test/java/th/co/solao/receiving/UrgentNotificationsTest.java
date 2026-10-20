package th.co.solao.receiving;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import android.Manifest;
import android.app.Application;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class UrgentNotificationsTest {
    private Context context;
    private NotificationManager manager;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        manager = context.getSystemService(NotificationManager.class);
        shadowOf((Application) context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
        UrgentNotifications.ensureChannel(context);
    }
    @Test public void channelUsesChosenSoundHighImportanceAndVibration() {
        NotificationChannel channel = manager.getNotificationChannel(UrgentNotifications.CHANNEL_ID);
        assertEquals("เรื่องด่วนรับสินค้า", channel.getName());
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.getImportance());
        assertEquals(UrgentNotifications.sound(context), channel.getSound());
        assertTrue(channel.shouldVibrate());
        assertEquals(AudioAttributes.USAGE_NOTIFICATION, channel.getAudioAttributes().getUsage());
    }
    @Test public void channelCreationIsIdempotentAndDoesNotOverrideUserSettings() {
        NotificationChannel first = manager.getNotificationChannel(UrgentNotifications.CHANNEL_ID);
        first.setSound(null, null);
        manager.createNotificationChannel(first);
        UrgentNotifications.ensureChannel(context);
        assertEquals(1, manager.getNotificationChannels().size());
        assertNull(manager.getNotificationChannel(UrgentNotifications.CHANNEL_ID).getSound());
    }
    @Test public void urgentFlagRepeatsUntilAcknowledgedWithHeadsUpAndPrivatePreview() {
        Notification alert = UrgentNotifications.build(context, 67, "เรื่องด่วน", "ตามของ", "{}");
        assertTrue((alert.flags & Notification.FLAG_INSISTENT) != 0);
        assertTrue((alert.flags & Notification.FLAG_AUTO_CANCEL) != 0);
        assertTrue((alert.flags & Notification.FLAG_ONGOING_EVENT) != 0);
        assertEquals(0, alert.flags & Notification.FLAG_ONLY_ALERT_ONCE);
        assertEquals(Notification.PRIORITY_HIGH, alert.priority);
        assertEquals(Notification.VISIBILITY_PRIVATE, alert.visibility);
        assertEquals(UrgentNotifications.CHANNEL_ID, alert.getChannelId());
        // Android 8+ reads audio/vibration from the channel, not these legacy fields.
        NotificationChannel channel = manager.getNotificationChannel(alert.getChannelId());
        assertEquals(UrgentNotifications.sound(context), channel.getSound());
        assertArrayEquals(new long[] {0, 400, 200, 400}, channel.getVibrationPattern());
    }
    @Test public void tapAndAcknowledgeOpenAppWithImmutableDistinctIntentsAndData() {
        Notification a = UrgentNotifications.build(context, 67, "ด่วน", "ตามของ", "{\"documentId\":7}");
        Notification b = UrgentNotifications.build(context, 68, "ด่วน", "ตามของ", "{}");
        Intent intent = shadowOf(a.contentIntent).getSavedIntent();
        assertEquals(MainActivity.class.getName(), intent.getComponent().getClassName());
        assertEquals(UrgentNotifications.ACTION, intent.getAction());
        assertEquals(67, intent.getIntExtra(UrgentNotifications.EXTRA_ID, 0));
        assertEquals("{\"documentId\":7}", intent.getStringExtra(UrgentNotifications.EXTRA_DATA));
        assertTrue(a.contentIntent.isImmutable());
        assertNotEquals(a.contentIntent, b.contentIntent);
        assertEquals("รับทราบ", a.actions[0].title);
        assertEquals(a.contentIntent, a.actions[0].actionIntent);
    }
    @Test public void cancellationStopsOnlyTheRequestedAlertAndIsIdempotent() {
        UrgentNotifications.post(context, 67, "ด่วน", "ตามของ", "{}");
        UrgentNotifications.post(context, 68, "ด่วน", "ตามของ", "{}");
        UrgentNotifications.cancel(context, 67);
        UrgentNotifications.cancel(context, 67);
        assertEquals(1, manager.getActiveNotifications().length);
        assertEquals(68, manager.getActiveNotifications()[0].getId());
    }
    @Test public void acknowledgmentStopsAlertOnColdOrWarmLaunchWithoutTouchingOthers() {
        UrgentNotifications.post(context, 67, "ด่วน", "ตามของ", "{}");
        Notification notification = UrgentNotifications.build(context, 67, "ด่วน", "ตามของ", "{}");
        Intent intent = shadowOf(notification.contentIntent).getSavedIntent();
        UrgentNotifications.acknowledge(context, intent);
        assertEquals(0, manager.getActiveNotifications().length);
        UrgentNotifications.acknowledge(context, intent);
        assertFalse(intent.hasExtra(UrgentNotifications.EXTRA_ID));
    }
    @Test public void unrelatedLaunchDoesNotCancelUrgentAlert() {
        UrgentNotifications.post(context, 67, "ด่วน", "ตามของ", "{}");
        UrgentNotifications.acknowledge(context, new Intent(Intent.ACTION_MAIN).putExtra(UrgentNotifications.EXTRA_ID, 67));
        UrgentNotifications.acknowledge(context, null);
        assertEquals(1, manager.getActiveNotifications().length);
    }
    @Test public void android13DenialDoesNotPostSilently() {
        shadowOf((Application) context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS);
        assertFalse(UrgentNotifications.permitted(context));
        assertThrows(SecurityException.class, () -> UrgentNotifications.post(context, 67, "ด่วน", "ตามของ", "{}"));
        assertEquals(0, manager.getActiveNotifications().length);
    }
    @Test @Config(sdk = 26) public void android8NeedsNoRuntimeNotificationPermission() {
        assertTrue(UrgentNotifications.permitted(context));
        UrgentNotifications.post(context, 67, "ด่วน", "ตามของ", "{}");
        assertEquals(1, manager.getActiveNotifications().length);
    }
    @Test @Config(sdk = 23) public void android6UsesLegacySoundVibrationAndPriority() {
        assertTrue(UrgentNotifications.permitted(context));
        UrgentNotifications.post(context, 67, "ด่วน", "ตามของ", "{}");
        Notification alert = shadowOf(manager).getAllNotifications().get(0);
        assertEquals(UrgentNotifications.sound(context), alert.sound);
        assertTrue((alert.flags & Notification.FLAG_INSISTENT) != 0);
        assertEquals(Notification.PRIORITY_HIGH, alert.priority);
    }
}
