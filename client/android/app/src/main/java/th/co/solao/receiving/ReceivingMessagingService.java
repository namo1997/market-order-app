package th.co.solao.receiving;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public final class ReceivingMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        // Token stays in Firebase's private SDK storage; sync reads the latest value.
        ReceivingPushWorker.enqueue(this, null, null);
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if ("followup".equals(data.get("kind")) && data.get("followup_id") != null &&
            data.get("followup_id").matches("[1-9][0-9]{0,8}")) {
            ReceivingPushWorker.enqueue(this, data.get("followup_id"), data.get("user_id"));
        }
    }
}
