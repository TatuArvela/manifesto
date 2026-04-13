import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { deleteAllNotes } from "../state/index.js";

export const showSettings = signal(false);

export function SettingsDialog() {
  const [status, setStatus] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!showSettings.value) return null;

  const handleDeleteAll = async () => {
    await deleteAllNotes();
    setShowDeleteConfirm(false);
    setStatus("All notes deleted");
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) showSettings.value = false;
      }}
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 class="text-lg font-semibold mb-4">Settings</h2>

        {/* Danger zone */}
        <div class="pt-2">
          <h3 class="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">
            Danger zone
          </h3>
          {showDeleteConfirm ? (
            <div class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p class="text-sm text-red-700 dark:text-red-300 mb-3">
                This will permanently delete all your notes. This action cannot
                be undone.
              </p>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
                  onClick={handleDeleteAll}
                >
                  Yes, delete everything
                </button>
                <button
                  type="button"
                  class="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-500"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              class="w-full px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg font-medium hover:bg-red-200 dark:hover:bg-red-900/50"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete my data
            </button>
          )}
        </div>

        {status && (
          <p class="mt-3 text-sm text-green-600 dark:text-green-400">
            {status}
          </p>
        )}

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={() => {
              showSettings.value = false;
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
