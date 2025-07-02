/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});

// Firebase Admin SDK 초기화
// Firebase Functions 환경에서는 별도의 설정 파일 없이 초기화 가능
admin.initializeApp();

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

/**
 * @name pickleGlassAuthCallback
 * @description
 * 클라이언트(Electron)로부터 Firebase ID 토큰을 받아 검증합니다.
 * 성공 시, 사용자 정보와 함께 성공 응답을 반환합니다.
 * 실패 시, 에러 메시지를 반환합니다.
 *
 * @param {object} request - HTTPS 요청 객체. body에 { token: "..." } 포함.
 * @param {object} response - HTTPS 응답 객체.
 */
const authCallbackHandler = (request, response) => {
  // CORS 프리플라이트 요청을 처리합니다.
  cors(request, response, async () => {
    try {
      logger.info("pickleGlassAuthCallback function triggered", {
        body: request.body,
      });

      // 1. 요청 방식이 POST인지, body가 있는지 확인
      if (request.method !== "POST") {
        response.status(405).send("Method Not Allowed");
        return;
      }
      if (!request.body || !request.body.token) {
        logger.error("Token is missing from the request body");
        response.status(400).send({
          success: false,
          error: "ID token is required.",
        });
        return;
      }

      const idToken = request.body.token;
      logger.info("Received token:", idToken.substring(0, 20) + "...");

      // 2. Firebase Admin SDK를 사용하여 토큰 검증
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;

      logger.info("Successfully verified token for UID:", uid);

      // 3. (NEW) 커스텀 토큰 생성
      const customToken = await admin.auth().createCustomToken(uid);

      // 4. 성공 응답 반환 (커스텀 토큰 포함)
      response.status(200).send({
        success: true,
        message: "Authentication successful.",
        user: {
          uid: decodedToken.uid,
          email: decodedToken.email,
          name: decodedToken.name,
          picture: decodedToken.picture,
        },
        customToken,
      });
    } catch (error) {
      logger.error("Authentication failed:", error);
      response.status(401).send({
        success: false,
        error: "Invalid token or authentication failed.",
        details: error.message,
      });
    }
  });
};

exports.pickleGlassAuthCallback = onRequest(
    {region: "us-west1"},
    authCallbackHandler,
);
