import { Schema as S } from "effect";
import { clientLog } from "./clientLog";
import { runClientUnscoped } from "./runtime";
import {
  type ComponentEntry,
  type ComponentPayload,
  type ComponentType,
  ComponentEntrySchema,
  ComponentPayloadSchema,
} from "../../components/pages/board-builder-page.logic";

const INDEX_KEY = "super_shaper_component_library_index";
const COMPONENT_PREFIX = "super_shaper_component_";

/**
 * Safely retrieves the component library index, handling malformed data gracefully.
 */
export function getComponentIndex(): ComponentEntry[] {
  runClientUnscoped(clientLog("info", "[ComponentLibraryStore] Fetching component index"));
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) {
      runClientUnscoped(clientLog("debug", "[ComponentLibraryStore] No component index found, returning empty array"));
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    const decodeIndex = S.decodeUnknownEither(S.Array(ComponentEntrySchema));
    const decoded = decodeIndex(parsed);
    if (decoded._tag === "Right") {
      runClientUnscoped(clientLog("debug", `[ComponentLibraryStore] Successfully parsed index with ${decoded.right.length} components`));
      return decoded.right;
    }
    runClientUnscoped(clientLog("warn", "[ComponentLibraryStore] Component index schema mismatch, resetting index"));
    return [];
  } catch (err) {
    runClientUnscoped(clientLog("error", "[ComponentLibraryStore] Failed to parse component index", err));
    return [];
  }
}

/**
 * Saves a partial board component payload to local storage with schema validation.
 * Returns the generated unique ID string.
 */
export function saveComponentToLibrary(name: string, type: ComponentType, payload: ComponentPayload): string {
  runClientUnscoped(clientLog("info", `[ComponentLibraryStore] Attempting to save component: ${name} of type: ${type}`));

  // 1. Validate payload using Effect-TS schema
  const decodePayload = S.decodeUnknownEither(ComponentPayloadSchema);
  const decoded = decodePayload(payload);
  if (decoded._tag === "Left") {
    runClientUnscoped(clientLog("error", `[ComponentLibraryStore] Save failed: Payload schema validation failed for type ${type}`));
    throw new Error(`Schema validation failed for component payload of type: ${type}`);
  }

  // 2. Generate unique ID
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
  const updatedAt = new Date().toISOString();
  const componentKey = `${COMPONENT_PREFIX}${id}`;

  // 3. Save payload to local storage
  try {
    localStorage.setItem(componentKey, JSON.stringify(payload));
    runClientUnscoped(clientLog("debug", `[ComponentLibraryStore] Saved component payload under key: ${componentKey}`));
  } catch (err) {
    runClientUnscoped(clientLog("error", `[ComponentLibraryStore] Failed to write component payload: ${id}`, err));
    throw err;
  }

  // 4. Update index
  const index = getComponentIndex();
  index.push({ id, name, type, updatedAt });

  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    runClientUnscoped(clientLog("info", `[ComponentLibraryStore] Component index updated successfully with entry: ${id}`));
  } catch (err) {
    // Rollback payload if index update fails
    localStorage.removeItem(componentKey);
    runClientUnscoped(clientLog("error", "[ComponentLibraryStore] Failed to save updated index, rolled back payload", err));
    throw err;
  }

  return id;
}

/**
 * Loads a component payload from local storage by its unique ID, validating its shape.
 * Returns null if the component is missing or fails validation.
 */
export function loadComponentFromLibrary(id: string): ComponentPayload | null {
  runClientUnscoped(clientLog("info", `[ComponentLibraryStore] Loading component: ${id}`));
  const componentKey = `${COMPONENT_PREFIX}${id}`;

  try {
    const raw = localStorage.getItem(componentKey);
    if (!raw) {
      runClientUnscoped(clientLog("warn", `[ComponentLibraryStore] Component payload not found for ID: ${id}`));
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    const decodePayload = S.decodeUnknownEither(ComponentPayloadSchema);
    const decoded = decodePayload(parsed);
    if (decoded._tag === "Right") {
      runClientUnscoped(clientLog("info", `[ComponentLibraryStore] Successfully loaded validated component: ${id}`));
      return decoded.right;
    }
    runClientUnscoped(clientLog("warn", `[ComponentLibraryStore] Component validation failed on load for ID: ${id}`));
    return null;
  } catch (err) {
    runClientUnscoped(clientLog("error", `[ComponentLibraryStore] Failed to load or parse component: ${id}`, err));
    return null;
  }
}

/**
 * Safely deletes a component payload and removes its entry from the library index.
 */
export function deleteComponentFromLibrary(id: string): void {
  runClientUnscoped(clientLog("info", `[ComponentLibraryStore] Deleting component: ${id}`));
  const componentKey = `${COMPONENT_PREFIX}${id}`;

  // 1. Remove payload
  localStorage.removeItem(componentKey);
  runClientUnscoped(clientLog("debug", `[ComponentLibraryStore] Removed payload for key: ${componentKey}`));

  // 2. Remove from index
  const index = getComponentIndex();
  const updatedIndex = index.filter(entry => entry.id !== id);

  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(updatedIndex));
    runClientUnscoped(clientLog("info", `[ComponentLibraryStore] Successfully deleted component ${id} and updated index`));
  } catch (err) {
    runClientUnscoped(clientLog("error", `[ComponentLibraryStore] Failed to update index after deleting component: ${id}`, err));
  }
}