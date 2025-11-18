
# Mwongozo wa Kuunganisha Frontend (Flutter) na Backend

Habari Gemini,

Wewe ni mtaalamu wa Dart na Flutter. Kazi yako ni kuunganisha Flutter app na backend yetu ya Node.js ambayo tayari ina usalama (authentication). Tafadhali fuata maelekezo haya kwa makini.

**Backend URL:**
-   **Production (Render):** `https://we-chat.onrender.com`
-   **Local Development (Android Emulator):** `http://10.0.2.2:3000`

**Lengo Kuu:**
Kila ombi (`request`) linalotumwa kwenda kwenye `endpoint` iliyolindwa lazima liwe na `Firebase ID Token` ya mtumiaji. Backend itakataa ombi lolote lisilo na `token` halali.

---

### Hatua 1: Uthibitishaji wa Mtumiaji (Firebase Authentication)

Hakikisha unatumia `firebase_auth` na `google_sign_in` kwa ajili ya usajili na kuingia.

**Muhimu:** Baada ya mtumiaji kuingia au kujisajili kwa mafanikio, kazi mbili lazima zifanyike:
1.  Pata `ID Token` yake.
2.  Tumia `token` hiyo kumtambulisha kwa `backend` kwa kuita `endpoint` ya `/api/setupNewUser`.

---

### Hatua 2: Kuunda `ApiService` na `Interceptor` (Njia Bora)

Njia bora na safi zaidi ya kushughulikia `authentication headers` ni kutumia `Dio Interceptor`. Hii itaongeza `ID Token` kiotomatiki kwa kila ombi.

**Vifurushi Vinavyohitajika (`pubspec.yaml`):**
```yaml
dependencies:
  dio: ^5.4.0 # or latest
    firebase_auth: ^4.15.3 # or latest
      # ... other packages
      ```

      **1. Unda `AuthInterceptor`:**
      Tengeneza faili jipya, k.m., `lib/services/auth_interceptor.dart`:

      ```dart
      import 'package:dio/dio.dart';
      import 'package:firebase_auth/firebase_auth.dart';

      // Hii Interceptor itaongeza Firebase ID token kwenye kila request
      class AuthInterceptor extends Interceptor {
        @override
          Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
              final User? user = FirebaseAuth.instance.currentUser;

                  if (user != null) {
                        try {
                                // Pata ID Token ya sasa. Hii itarefresh token ikiwa imekwisha muda.
                                        final idToken = await user.getIdToken(true);
                                                // Weka token kwenye header
                                                        options.headers['Authorization'] = 'Bearer $idToken';
                                                                print('Authorization token added to header.');
                                                                      } catch (e) {
                                                                              print('Error getting ID token: $e');
                                                                                      // Unaweza kushughulikia error hapa, k.m., kumwondoa mtumiaji
                                                                                            }
                                                                                                }
                                                                                                    
                                                                                                        // Ruhusu request iendelee
                                                                                                            return super.onRequest(options, handler);
                                                                                                              }
                                                                                                              }
                                                                                                              ```

                                                                                                              **2. Unda `ApiService`:**
                                                                                                              Tengeneza faili la `lib/services/api_service.dart`:

                                                                                                              ```dart
                                                                                                              import 'package:dio/dio.dart';
                                                                                                              import 'auth_interceptor.dart'; // Import interceptor

                                                                                                              class ApiService {
                                                                                                                final Dio _dio;

                                                                                                                  // Tumia URL yako ya Render hapa kwa production
                                                                                                                    static const String _baseUrl = 'https://we-chat.onrender.com/api'; 

                                                                                                                      ApiService() : _dio = Dio(BaseOptions(baseUrl: _baseUrl)) {
                                                                                                                          // **Sajili Interceptor hapa**
                                                                                                                              _dio.interceptors.add(AuthInterceptor());
                                                                                                                                }

                                                                                                                                  /// Inaitwa mara moja tu baada ya mtumiaji kujisajili/kuingia kwa mara ya kwanza.
                                                                                                                                    /// Backend itatengeneza profile yake kwenye Firestore.
                                                                                                                                      Future<void> setupNewUser() async {
                                                                                                                                          try {
                                                                                                                                                // Auth token itaongezwa kiotomatiki na Interceptor
                                                                                                                                                      final response = await _dio.post('/setupNewUser');
                                                                                                                                                            print('ApiService - setupNewUser successful: ${response.data}');
                                                                                                                                                                } on DioException catch (e) {
                                                                                                                                                                      // Ikiwa token ni invalid, backend itarudisha error 401 au 403
                                                                                                                                                                            print('ApiService - Error setting up user: ${e.response?.statusCode} - ${e.response?.data}');
                                                                                                                                                                                  // Re-throw ili UI iweze ku-handle
                                                                                                                                                                                        throw _handleError(e);
                                                                                                                                                                                            }
                                                                                                                                                                                              }

                                                                                                                                                                                                /// Inaanza live stream kwa mtumiaji wa sasa.
                                                                                                                                                                                                  Future<void> startLiveStream() async {
                                                                                                                                                                                                      try {
                                                                                                                                                                                                            await _dio.post('/livestreams/start');
                                                                                                                                                                                                                  print('ApiService - Stream started successfully');
                                                                                                                                                                                                                      } on DioException catch (e) {
                                                                                                                                                                                                                            throw _handleError(e);
                                                                                                                                                                                                                                }
                                                                                                                                                                                                                                  }

                                                                                                                                                                                                                                    /// Inasimamisha live stream kwa mtumiaji wa sasa.
                                                                                                                                                                                                                                      Future<void> stopLiveStream() async {
                                                                                                                                                                                                                                          try {
                                                                                                                                                                                                                                                await _dio.post('/livestreams/stop');
                                                                                                                                                                                                                                                      print('ApiService - Stream stopped successfully');
                                                                                                                                                                                                                                                          } on DioException catch (e) {
                                                                                                                                                                                                                                                                throw _handleError(e);
                                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                        
                                                                                                                                                                                                                                                                          // Unaweza kuongeza methods zingine hapa...

                                                                                                                                                                                                                                                                            // Helper function for error handling
                                                                                                                                                                                                                                                                              Exception _handleError(DioException e) {
                                                                                                                                                                                                                                                                                  print('ApiService - Dio Error: ${e.message}');
                                                                                                                                                                                                                                                                                      // Unaweza ku-customize error messages hapa
                                                                                                                                                                                                                                                                                          return Exception("Failed to communicate with the server. Please try again.");
                                                                                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                                                                            ```

                                                                                                                                                                                                                                                                                            ---

                                                                                                                                                                                                                                                                                            ### Hatua 3: Mzunguko wa Matukio (User Flow)

                                                                                                                                                                                                                                                                                            Hivi ndivyo `logic` inavyopaswa kuwa ndani ya UI/state management yako.

                                                                                                                                                                                                                                                                                            **1. Wakati wa Kuingia/Kujisajili:**

                                                                                                                                                                                                                                                                                            Baada ya `FirebaseAuth.instance.signInWithCredential()` au `createUserWithEmailAndPassword()` kufanikiwa, mara moja ita `setupNewUser` endpoint.

                                                                                                                                                                                                                                                                                            ```dart
                                                                                                                                                                                                                                                                                            import 'package:firebase_auth/firebase_auth.dart';
                                                                                                                                                                                                                                                                                            import 'package:we_chat/services/api_service.dart'; // Import service yako

                                                                                                                                                                                                                                                                                            class AuthService {
                                                                                                                                                                                                                                                                                              final FirebaseAuth _auth = FirebaseAuth.instance;
                                                                                                                                                                                                                                                                                                final ApiService _apiService = ApiService();

                                                                                                                                                                                                                                                                                                  Future<void> handleSignIn() async {
                                                                                                                                                                                                                                                                                                      try {
                                                                                                                                                                                                                                                                                                            // Logic yako ya ku-sign in (k.m., Google Sign-In)
                                                                                                                                                                                                                                                                                                                  final UserCredential userCredential = await _signInWithGoogle(); // Mfano

                                                                                                                                                                                                                                                                                                                        if (userCredential.additionalUserInfo?.isNewUser == true) {
                                                                                                                                                                                                                                                                                                                                print("New user detected. Calling setupNewUser on backend...");
                                                                                                                                                                                                                                                                                                                                        await _apiService.setupNewUser();
                                                                                                                                                                                                                                                                                                                                              } else {
                                                                                                                                                                                                                                                                                                                                                      print("Existing user logged in.");
                                                                                                                                                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                                                                                                                                                  
                                                                                                                                                                                                                                                                                                                                                                        // Elekeza mtumiaji kwenda kwenye Home Screen
                                                                                                                                                                                                                                                                                                                                                                              // ...

                                                                                                                                                                                                                                                                                                                                                                                  } catch (e) {
                                                                                                                                                                                                                                                                                                                                                                                        print("Sign-in failed: $e");
                                                                                                                                                                                                                                                                                                                                                                                              // Onyesha error kwa mtumiaji
                                                                                                                                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                                                                                                                                                                      
                                                                                                                                                                                                                                                                                                                                                                                                        // Mfano wa Google Sign-In
                                                                                                                                                                                                                                                                                                                                                                                                          Future<UserCredential> _signInWithGoogle() async {
                                                                                                                                                                                                                                                                                                                                                                                                              // ... implement google sign-in logic ...
                                                                                                                                                                                                                                                                                                                                                                                                                  // ... return UserCredential ...
                                                                                                                                                                                                                                                                                                                                                                                                                      throw UnimplementedError();
                                                                                                                                                                                                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                                                                                                                                                                                                        ```

                                                                                                                                                                                                                                                                                                                                                                                                                        **2. Wakati wa Kutumia Feature Nyingine (k.m., Kuanza Live Stream):**

                                                                                                                                                                                                                                                                                                                                                                                                                        Sasa, kutoka popote kwenye app, unaweza kuita `methods` za `ApiService` moja kwa moja. `Interceptor` itashughulikia `token` kiotomatiki.

                                                                                                                                                                                                                                                                                                                                                                                                                        ```dart
                                                                                                                                                                                                                                                                                                                                                                                                                        // Kwenye State/Controller/ViewModel yako
                                                                                                                                                                                                                                                                                                                                                                                                                        class LiveStreamViewModel {
                                                                                                                                                                                                                                                                                                                                                                                                                          final ApiService _apiService = ApiService();
                                                                                                                                                                                                                                                                                                                                                                                                                            
                                                                                                                                                                                                                                                                                                                                                                                                                              Future<void> goLive() async {
                                                                                                                                                                                                                                                                                                                                                                                                                                  try {
                                                                                                                                                                                                                                                                                                                                                                                                                                        await _apiService.startLiveStream();
                                                                                                                                                                                                                                                                                                                                                                                                                                              // Update UI kuonyesha mtumiaji yupo live
                                                                                                                                                                                                                                                                                                                                                                                                                                                  } catch (e) {
                                                                                                                                                                                                                                                                                                                                                                                                                                                        // Onyesha error kwa mtumiaji
                                                                                                                                                                                                                                                                                                                                                                                                                                                              print("Failed to start live stream: $e");
                                                                                                                                                                                                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                    ```

                                                                                                                                                                                                                                                                                                                                                                                                                                                                    Hayo ndiyo maelekezo kamili. Ukiyafuata, app ya Flutter itawasiliana na backend kwa usalama na ufanisi.
                                                                                                                                                                                                                                                                                                                                                                                                                                                      
                                                                                                                                                                                                                                                                                                                                                                                                          