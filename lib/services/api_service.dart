
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

// A custom exception for API-related errors.
class ApiException implements Exception {
  final String message;
  final int? statusCode;

  ApiException(this.message, {this.statusCode});

  @override
  String toString() {
    return "ApiException: $message (Status Code: $statusCode)";
  }
}

class ApiService {
  final Dio _dio;
  final FirebaseAuth _firebaseAuth;

  // Base URL for the API. It switches based on the platform.
  // For production, use your Render URL.
  static final String _baseUrl = kReleaseMode 
      ? 'https://we-chat-1-flwd.onrender.com/api' 
      : (defaultTargetPlatform == TargetPlatform.android
          ? 'http://10.0.2.2:3000/api'
          : 'http://localhost:3000/api');

  // --- SINGLETON SETUP ---
  static final ApiService _instance = ApiService._internal(
    Dio(BaseOptions(baseUrl: _baseUrl)),
    FirebaseAuth.instance,
  );

  factory ApiService() {
    return _instance;
  }

  ApiService._internal(this._dio, this._firebaseAuth) {
    // Add an interceptor to automatically handle the Authorization header.
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final user = _firebaseAuth.currentUser;
          if (user != null) {
            try {
              // Force refresh the token if it's about to expire
              final token = await user.getIdToken(true);
              options.headers['Authorization'] = 'Bearer $token';
            } catch (e) {
              debugPrint("Error getting Firebase ID token: $e");
              return handler.reject(
                DioError(
                  requestOptions: options,
                  error: "Could not refresh auth token.",
                ),
              );
            }
          }
          return handler.next(options);
        },
        onError: (e, handler) {
          debugPrint("Dio Error: ${e.message}");
          debugPrint("Response: ${e.response?.data}");
          return handler.next(e);
        },
      ),
    );
  }

  // --- HELPER METHOD TO HANDLE DIO ERRORS ---
  dynamic _handleDioError(DioError e, String endpoint) {
    if (e.response != null) {
      debugPrint("API Error on $endpoint: ${e.response?.statusCode} - ${e.response?.data}");
      throw ApiException(e.response?.data?['error'] ?? 'An unknown API error occurred.', statusCode: e.response?.statusCode);
    } else {
      debugPrint("Network Error on $endpoint: ${e.message}");
      throw ApiException('Network error. Please check your connection.');
    }
  }

  // --- API METHODS ---

  /// 1. Sets up a new user profile on the backend.
  Future<void> setupNewUser() async {
    try {
      await _dio.post('/setupNewUser');
    } on DioError catch (e) {
      // It's okay if the user already exists (200 OK), any other error is a problem.
      if (e.response?.statusCode != 200) {
        _handleDioError(e, 'setupNewUser');
      }
    }
  }

  /// 2. Initiates a coin recharge transaction.
  Future<String> initiateRecharge({
    required String packageId,
    required String phoneNumber,
  }) async {
    try {
      final response = await _dio.post('/recharge/initiate', data: {
        'packageId': packageId,
        'phoneNumber': phoneNumber,
      });
      final redirectUrl = response.data?['redirectUrl'];
      if (redirectUrl != null) {
        return redirectUrl;
      } else {
        throw ApiException('Did not receive a redirect URL.');
      }
    } on DioError catch (e) {
      return _handleDioError(e, 'initiateRecharge');
    }
  }
  
  /// 3. **NEW**: Generates a LiveKit access token to join a call.
  Future<String> getLiveKitToken({
    required String roomName,
    required String participantIdentity,
  }) async {
    // The participantIdentity MUST be the UID of the currently authenticated user.
    try {
      final response = await _dio.post('/calls/livekit-token', data: {
        'roomName': roomName,
        'participantIdentity': participantIdentity,
      });
      final token = response.data?['token'];
      if (token != null) {
        return token;
      } else {
        throw ApiException('Did not receive a LiveKit token.');
      }
    } on DioError catch (e) {
      return _handleDioError(e, 'getLiveKitToken');
    }
  }

  /// 4. Informs the backend that the user is starting a live stream.
  Future<void> startLiveStream() async {
    try {
      await _dio.post('/livestreams/start');
    } on DioError catch (e) {
      _handleDioError(e, 'startLiveStream');
    }
  }

  /// 5. Informs the backend that the user is stopping a live stream.
  Future<void> stopLiveStream() async {
    try {
      await _dio.post('/livestreams/stop');
    } on DioError catch (e) {
      _handleDioError(e, 'stopLiveStream');
    }
  }

  /// 6. Gets a list of all currently live users.
  Future<List<dynamic>> getLiveStreams() async {
    try {
      final response = await _dio.get('/livestreams');
      return response.data?['liveUsers'] ?? [];
    } on DioError catch (e) {
      return _handleDioError(e, 'getLiveStreams');
    }
  }

  /// 7. Grants a coin reward after a user watches a rewarded ad.
  Future<void> grantAdReward() async {
    try {
      await _dio.post('/rewards/grant-ad-reward');
    } on DioError catch (e) {
      _handleDioError(e, 'grantAdReward');
    }
  }
}
