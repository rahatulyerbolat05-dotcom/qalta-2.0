# Қalta

Финансовый трекер — учёт расходов/доходов, долги, категории, тема и акцентный цвет, локализация (Рус/Қаз/Eng). PWA — можно добавить на домашний экран телефона.

Открыть: см. ссылку GitHub Pages в настройках репозитория (Settings → Pages).

## Синхронизация между устройствами (опционально)

По умолчанию данные хранятся только в localStorage этого браузера. Чтобы включить вход через Google и синхронизацию через Firestore:

1. [console.firebase.google.com](https://console.firebase.google.com) → Add project
2. Authentication → Sign-in method → включить **Google**
3. Firestore Database → Create database
4. Project settings → General → Your apps → Add app → Web (`</>`)
5. Скопировать объект `firebaseConfig` в `firebase-config.js` (см. пример внутри файла)
6. Firestore Database → Rules → вставить содержимое `firestore.rules` из этого репозитория

`firebase-config.js` не является секретом — это публичный идентификатор проекта, реальная защита данных обеспечивается `firestore.rules` (каждый пользователь видит только свой документ).
