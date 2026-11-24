import {
  defaultSettings,
  parseOrThrow,
  settingsSchema,
  type Settings,
  type SettingsRepository,
} from "@flawdot/core-model";

/** The settings are `null` until the user changes one, and then the defaults are what is returned. */
export interface SettingsStorage {
  value: Settings | null;
}

export function createSettingsRepository(storage: SettingsStorage): SettingsRepository {
  const inForce = (): Settings => storage.value ?? defaultSettings();
  return {
    get: async () => structuredClone(inForce()),
    update: async (patch) => {
      const changes = Object.entries(patch).filter(([, value]) => value !== undefined);
      // The whole result is checked before it is stored: a patch that is not valid changes nothing.
      const next = parseOrThrow(
        settingsSchema,
        { ...inForce(), ...Object.fromEntries(changes) },
        { what: "settings" },
      );
      storage.value = next;
      return structuredClone(next);
    },
  };
}
