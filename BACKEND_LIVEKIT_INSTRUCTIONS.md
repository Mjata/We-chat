
# Maelekezo kwa Backend: Kuunganisha na LiveKit

Habari Backend Developer,

Programu ya Flutter imehamia kutumia **LiveKit** kwa ajili ya simu za sauti na video. Ili mfumo huu ufanye kazi, tunahitaji `endpoint` mpya na salama kwenye `server` yetu ambayo itatengeneza `access tokens` za LiveKit.

Tafadhali fuata hatua hizi:

---

### Hatua ya 1: Pata "Credentials" za LiveKit

Unahitaji kupata `API credentials` kutoka kwenye `dashboard` ya LiveKit Cloud.

1.  Ingia kwenye [LiveKit Cloud](https://cloud.livekit.io/).
2.  Chagua mradi wetu: `we-chat-k0bb5qx2`.
3.  Nenda kwenye **Settings** -> **Keys**.
4.  Hapo utapata `values` mbili muhimu:
    *   **API Key** (inaanza na `API...`)
    *   **API Secret** (ni `string` ndefu)

---

### Hatua ya 2: Weka "Environment Variables" Kwenye Render

Kwa usalama, `credentials` hizi **hazipaswi kuandikwa moja kwa moja kwenye code**. Tafadhali ziongeze kama `environment variables` kwenye `dashboard` ya Render.

1.  Nenda kwenye `dashboard` ya Render.com.
2.  Chagua `backend service` yetu.
3.  Nenda kwenye sehemu ya **"Environment"**.
4.  Ongeza `variables` mbili mpya:
    *   **Key:** `LIVEKIT_API_KEY`
    *   **Value:** (Weka `API Key` uliyonakili hapa)
    *   **Key:** `LIVEKIT_API_SECRET`
    *   **Value:** (Weka `API Secret` uliyonakili hapa)

Server itahitaji kuanza upya (`restart`) ili kutumia hizi `variables` mpya.

---

### Hatua ya 3: Tengeneza "LiveKit Token Endpoint"

Tunahitaji `endpoint` mpya iliyo salama ambayo `app` ya Flutter itaiita ili kupata `token` ya muda ya LiveKit.

#### Maelezo ya Endpoint:
- **URL**: `/api/calls/livekit-token`
- **Method**: `POST`
- **Authentication**: `Endpoint` hii ni lazima iwe salama. App ya Flutter itatuma `Firebase ID Token` ya mtumiaji kwenye `header` (`Authorization: Bearer <ID_TOKEN>`). `Backend` inapaswa kuhakiki `token` hii kwa kutumia `authMiddleware` iliyopo.

#### Request Body:
`Endpoint` inapaswa kupokea `JSON body` yenye muundo huu:
```json
{
  "roomName": "jina-la-chumba-la-kipekee",
  "participantIdentity": "firebase-user-uid" 
}
```

#### Mfano wa Utekelezaji (Node.js / Express):

1.  **Sakinisha SDK**:
    Hakikisha una kifurushi cha `livekit-server-sdk`.
    ```bash
    npm install livekit-server-sdk
    ```

2.  **Mantiki ya Endpoint**:
    Huu ni mfano kamili wa jinsi ya kutengeneza `endpoint`. Inajumuisha uthibitisho wa Firebase na utengenezaji wa `token`.

    ```javascript
    import { AccessToken } from 'livekit-server-sdk';
    
    // ... (code zako zingine za imports na middleware)

    // Weka hii endpoint mpya kwenye index.js
    app.post('/api/calls/livekit-token', authMiddleware, (req, res) => {
      // 1. Pata API Key na Secret kutoka kwenye environment variables
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;

      // 2. Pata roomName na participantIdentity kutoka kwenye request body
      const { roomName, participantIdentity } = req.body;
      
      // 3. Pata UID ya mtumiaji aliyeidhinishwa kutoka kwenye middleware
      const authenticatedUserId = req.user.uid;

      // 4. Ukaguzi wa Usalama: Hakikisha anayeomba token ndiye atakayeitumia
      if (participantIdentity !== authenticatedUserId) {
        return res.status(403).json({ error: 'Forbidden: Unaweza kuomba token kwa ajili yako tu.' });
      }

      // 5. Hakiki vigezo (inputs)
      if (!apiKey || !apiSecret) {
        console.error('LiveKit server keys hazijawekwa kwenye backend.');
        return res.status(500).json({ error: 'LiveKit server keys hazijawekwa.' });
      }
      if (!roomName || !participantIdentity) {
        return res.status(400).json({ error: 'roomName na participantIdentity vinahitajika.' });
      }

      // 6. Tengeneza AccessToken
      const at = new AccessToken(apiKey, apiSecret, {
        identity: participantIdentity,
      });

      // 7. Toa ruhusa ya kujiunga na chumba
      at.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,      // Ruhusu kutuma sauti/video
        canSubscribe: true,    // Ruhusu kupokea sauti/video
      });

      // 8. Tengeneza token (JWT)
      const token = at.toJwt();
      
      console.log(`Token ya LiveKit imetengenezwa kwa mtumiaji: ${participantIdentity}`);
      
      // 9. Tuma token kwa app ya Flutter
      return res.status(200).json({ token: token });
    });
    ```

Asante!
