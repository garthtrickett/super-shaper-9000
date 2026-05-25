import type { BoardModel } from "../../components/pages/board-builder-page.logic";
import { clientLog } from "./clientLog";
import { runClientUnscoped } from "./runtime";

export interface LibraryEntry {
  id: string;
  name: string;
  updatedAt: string;
}

export type LibraryIndex = LibraryEntry[];

const INDEX_KEY = "super_shaper_library_index";
const BOARD_PREFIX = "super_shaper_library_board_";

/**
 * Fetches the library index metadata safely, handling corrupted storage values gracefully.
 */
export function getLibraryIndex(): LibraryEntry[] {
  runClientUnscoped(clientLog("info", "[LibraryStore] Fetching library index"));
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) {
      runClientUnscoped(clientLog("debug", "[LibraryStore] No index found, returning empty list"));
      return [];
    }
        const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      runClientUnscoped(clientLog("debug", `[LibraryStore] Successfully parsed index with ${parsed.length} entries`));
      return parsed as LibraryEntry[];
    }
    runClientUnscoped(clientLog("warn", "[LibraryStore] Index was not an array, resetting index"));
    return [];
  } catch (err) {
    runClientUnscoped(clientLog("error", "[LibraryStore] Failed to parse library index", err));
    return [];
  }
}

/**
 * Saves a BoardModel design to local storage under a unique ID, then updates the index.
 * Returns the generated unique ID string.
 */
export function saveBoardToLibrary(name: string, state: BoardModel): string {
  runClientUnscoped(clientLog("info", `[LibraryStore] Saving board as: ${name}`));
  
  // 1. Generate unique ID
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
  runClientUnscoped(clientLog("debug", `[LibraryStore] Generated unique ID: ${id}`));
  
  const updatedAt = new Date().toISOString();
  
  // 2. Save the full payload
  const boardKey = `${BOARD_PREFIX}${id}`;
  try {
    localStorage.setItem(boardKey, JSON.stringify(state));
    runClientUnscoped(clientLog("debug", `[LibraryStore] Saved board payload under key: ${boardKey}`));
  } catch (err) {
    runClientUnscoped(clientLog("error", `[LibraryStore] Failed to save board payload: ${id}`, err));
    throw err;
  }
  
  // 3. Update the index
  const index = getLibraryIndex();
  index.push({ id, name, updatedAt });
  
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    runClientUnscoped(clientLog("info", `[LibraryStore] Library index updated successfully with new entry: ${id}`));
  } catch (err) {
    // Rollback payload save if index update fails
    localStorage.removeItem(boardKey);
    runClientUnscoped(clientLog("error", "[LibraryStore] Failed to save updated index, rolled back payload", err));
    throw err;
  }
  
  return id;
}

/**
 * Retrieves a saved BoardModel design payload by its unique ID.
 * Returns null if the board is not found or fails to parse.
 */
export function loadBoardFromLibrary(id: string): BoardModel | null { 
  runClientUnscoped(clientLog("info", `[LibraryStore] Loading board: ${id}`));
  const boardKey = `${BOARD_PREFIX}${id}`;
  
  try {
    const raw = localStorage.getItem(boardKey);
    if (!raw) {
      runClientUnscoped(clientLog("warn", `[LibraryStore] Board payload not found for ID: ${id}`));
      return null;
    }
    
    const parsed = JSON.parse(raw) as BoardModel;
    runClientUnscoped(clientLog("info", `[LibraryStore] Successfully loaded board: ${id}`));
    return parsed;
  } catch (err) {
    runClientUnscoped(clientLog("error", `[LibraryStore] Failed to load/parse board: ${id}`, err));
    return null;
  }
}

/**
 * Safely deletes a board design payload and removes its entry from the index.
 */
export function deleteBoardFromLibrary(id: string): void {
  runClientUnscoped(clientLog("info", `[LibraryStore] Deleting board: ${id}`));
  const boardKey = `${BOARD_PREFIX}${id}`;
  
  // 1. Remove board payload
  localStorage.removeItem(boardKey);
  runClientUnscoped(clientLog("debug", `[LibraryStore] Removed payload for key: ${boardKey}`));
  
  // 2. Remove from index
  const index = getLibraryIndex();
  const updatedIndex = index.filter(entry => entry.id !== id);
  
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(updatedIndex));
    runClientUnscoped(clientLog("info", `[LibraryStore] Successfully deleted board ${id} and updated index`));
  } catch (err) {
    runClientUnscoped(clientLog("error", `[LibraryStore] Failed to update index after deleting board: ${id}`, err));
  }
}
