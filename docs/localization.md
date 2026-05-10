# Localization & Languages

Mesh-Client is designed to be accessible to mesh users worldwide. The application currently supports **16 languages** and uses static translation bundles to ensure full functionality even when offline.

---

## Supported Languages

The following languages are currently supported:

- **English** (Source of Truth)
- **Spanish** (Español)
- **Ukrainian** (Українська)
- **German** (Deutsch)
- **Chinese (Simplified)** (简体中文)
- **Portuguese (Brazilian)** (Português do Brasil)
- **French** (Français)
- **Italian** (Italiano)
- **Polish** (Polski)
- **Czech** (Čeština)
- **Japanese** (日本語)
- **Russian** (Русский)
- **Dutch** (Nederlands)
- **Korean** (한국어)
- **Turkish** (Türkçe)
- **Indonesian** (Bahasa Indonesia)

---

## Changing Languages

To change the interface language:

1. Locate the **globe icon** in the application header.
2. Click the icon to open the language selection dropdown.
3. Select your preferred language.

The application will immediately update the UI strings. Your language preference is saved to your local settings and will persist across app restarts.

---

## Contributing Translations

Most translations in Mesh-Client are initially machine-generated using [MyMemory](https://mymemory.translated.net/). We rely on community contributions to improve translation quality and accuracy.

### Reporting an Error

If you find a mistranslation or an awkward phrasing:

1. Go to the [Mesh-Client Issues](https://github.com/Colorado-Mesh/mesh-client/issues) page.
2. Open a new [Translation Error](https://github.com/Colorado-Mesh/mesh-client/issues/new?assignees=&labels=translation&template=translation-error.md&title=Translation+Error) issue.
3. Provide the current text and your suggested correction.

### Adding a New Language

If you would like to help us add support for a new language:

1. Check existing issues to see if someone is already working on it.
2. Open a [Feature Request](https://github.com/Colorado-Mesh/mesh-client/issues/new?template=feature_request.md) specifically for the new language.
3. We will help you set up the initial locale files and guide you through the translation process.

---

## Offline Support

Translations are bundled as static JSON files within the application. Unlike many web apps, Mesh-Client **does not make network calls** to fetch translations at runtime. This ensures that the interface remains in your preferred language even when you are operating off-grid or in environments with no internet access.
