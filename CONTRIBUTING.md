# Contributing

Thanks for helping improve BernAudio Model 80.

## Before opening a change

1. Read the project README and preserve its distinction between live audio measurements and synthetic simulations.
2. Keep microphone capture and audio processing local unless a change explicitly documents a new data flow.
3. Do not add credentials, private recordings, personal data or real event-location data to the repository.
4. Keep measurement limitations visible. Do not describe uncalibrated phone or microphone readings as certified absolute SPL.

## Suggested workflow

1. Fork the repository and create a focused branch.
2. Make one logically grouped change.
3. Test the affected page in a current desktop browser and, when relevant, on a mobile browser with microphone permission.
4. Check browser-console errors, permission-denied behavior, missing-device behavior and resize/orientation behavior for UI or audio changes.
5. Open a pull request with the purpose, files changed, manual test steps, browser/device tested and known limitations.

## Review expectations

Prefer small, accessible, responsive changes. Preserve existing offline/PWA behavior and avoid forcing a reload during an active measurement. For signal-processing changes, explain assumptions, units, windowing, calibration requirements and known error sources.
