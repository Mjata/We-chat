
ayHabari Gemini,

Wewe ni mtaalamu wa Dart na Flutter. Kazi yako ni kutengeneza "API Service Layer" kamili kwa ajili ya app yetu. Huduma hii itawasiliana na backend yetu ya Node.js/Express. Tafadhali tengeneza `class` ya `ApiService` ambayo itakuwa na `method` kwa kila `endpoint` iliyoorodheshwa hapa chini.

**Muhimu:**
1.  **Base URL**: Backend inapatikana kwenye `http://10.0.2.2:3000`. Hii ni anwani kwa ajili ya Android Emulator.
2.  **Authentication**: Kila ombi linalohitaji uthibitisho (`auth`) lazima liwe na `header` ifuatayo: `Authorization: Bearer <ID_TOKEN>`, ambapo `<ID_TOKEN>` ni tokeni unayoipata kutoka kwa Firebase Auth baada ya mtumiaji kuingia.
3.  **Vifurushi (Packages)**: Tumia `http` au `dio` kwa ajili ya maombi ya mtandao.
4.  **Error Handling**: Hakikisha unafanya ushughulikiaji mzuri wa makosa (error handling) kwa kila `method`.

Hizi ndizo `endpoints` za kutengeneza:

---

### **1. User & Account**

#### `setupNewUser`
*   **Maelezo**: Inaitwa mara tu baada ya mtumiaji kujisajili kwa mara ya kwanza ili kuunda wasifu wake kwenye database.
*   **Method**: `POST`
*   **Endpoint**: `/api/setupNewUser`
*   **Auth**: Inahitajika.
*   **Body**: Hakuna.

---

### **2. Payments & Recharge (Pesapal)**

#### `initiateRecharge`
*   **Maelezo**: Huanzisha mchakato wa malipo ya kununua coins. Backend itarudisha URL ya malipo ya Pesapal.
*   **Method**: `POST`
*   **Endpoint**: `/api/recharge/initiate`
*   **Auth**: Inahitajika.
*   **Body**: `{"packageId": "pack1"}` (au `pack2`, `pack3`)
*   **Majibu (Response)**: Inarudisha JSON yenye `paymentRedirectUrl`. Unatakiwa kufungua URL hii kwenye `WebView`.

---

### **3. Live Streaming**

#### `startLiveStream`
*   **Maelezo**: Inamruhusu mtumiaji kuanza kutiririsha video mubashara (live).
*   **Method**: `POST`
*   **Endpoint**: `/api/livestreams/start`
*   **Auth**: Inahitajika.
*   **Body**: Hakuna.

#### `stopLiveStream`
*   **Maelezo**: Inasitisha live stream ya mtumiaji.
*   **Method**: `POST`
*   **Endpoint**: `/api/livestreams/stop`
*   **Auth**: Inahitajika.
*   **Body**: Hakuna.

#### `getLiveStreams`
*   **Maelezo**: Inapata orodha ya watumiaji wote walio hewani (live) kwa sasa.
*   **Method**: `GET`
*   **Endpoint**: `/api/livestreams`
*   **Auth**: Inahitajika.
*   **Majibu (Response)**: Inarudisha orodha ya `liveUsers`.

---

### **4. Video & Voice Calls**

#### `startCall`
*   **Maelezo**: Huomba ruhusa ya kuanza simu na kuangalia kama mpigaji ana coins za kutosha.
*   **Method**: `POST`
*   **Endpoint**: `/api/calls/start`
*   **Auth**: Inahitajika.
*   **Body**: `{"calleeId": "UID_YA_UNAYEMPIGIA"}`
*   **Majibu (Response)**: Inarudisha `callId` ambayo itatumika kwenye `charge` na `end`.

#### `chargeCall`
*   **Maelezo**: Hii inapaswa kuitwa **kila dakika** wakati simu inaendelea ili kukata coins. Ikiwa coins zitaisha, itarudisha `status code 403`.
*   **Method**: `POST`
*   **Endpoint**: `/api/calls/charge`
*   **Auth**: Inahitajika.
*   **Body**: `{"callId": "ID_YA_SIMU_KUTOKA_STARTCALL"}`
*   **Kushughulikia Kosa (Error Handling)**: Ikiwa unapata `403 Forbidden`, unapaswa kukata simu upande wa app.

#### `endCall`
*   **Maelezo**: Inaarifu backend kuwa simu imekamilika na inatuma muda wa simu.
*   **Method**: `POST`
*   **Endpoint**: `/api/calls/end`
*   **Auth**: Inahitajika.
*   **Body**: `{"callId": "ID_YA_SIMU", "duration": 120}` (muda katika sekunde).

---

### **5. AdMob Rewards**

#### `grantAdReward`
*   **Maelezo**: Inaitwa baada ya mtumiaji kumaliza kuangalia tangazo la zawadi (rewarded ad) ili kumpa coins.
*   **Method**: `POST`
*   **Endpoint**: `/api/rewards/grant-ad-reward`
*   **Auth**: Inahitajika.
*   **Body**: Hakuna.
