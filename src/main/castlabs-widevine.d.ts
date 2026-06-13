/**
 * Type declarations for castLabs Electron Content Shell (ECS) Widevine events.
 *
 * castLabs ECS emits 'widevine-ready' and 'widevine-error' on the app object
 * once the bundled Widevine CDM binaries have been initialised. These events
 * are not present in the standard Electron type definitions, so we augment
 * the Electron.App interface here.
 */

import 'electron';

declare global {
  namespace Electron {
    interface App {
      on(event: 'widevine-ready', listener: (event: Event, widevineVersion: string) => void): this;
      on(event: 'widevine-error', listener: (event: Event, error: Error) => void): this;
    }
  }
}
