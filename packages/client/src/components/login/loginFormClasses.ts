// The form controls of the sign-in screen, shared by each of its steps.

import { buttonClass } from "#/components/buttonClasses.ts";

export const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";
export const submitClass = `${buttonClass("primary")} w-full`;
export const quietClass =
  "w-full text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200";
