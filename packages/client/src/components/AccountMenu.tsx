import { LogOut, UserCog } from "lucide-preact";
import { useState } from "preact/hooks";
import { plural, t } from "#/i18n/index.ts";
import { currentUser, isServerMode } from "#/state/account/auth.ts";
import { signOut } from "#/state/account/signOut.ts";
import { askConfirmation } from "#/state/confirm.ts";
import { openSettings } from "#/state/ui.ts";
import { unsentNotes } from "#/state/unsentNotes.ts";
import { Avatar } from "./Avatar.tsx";
import {
  menuDividerClass,
  menuItemClass,
  menuPanelClass,
} from "./card/NoteMenu.tsx";
import { Dropdown } from "./Dropdown.tsx";
import { Tooltip } from "./Tooltip.tsx";

/**
 * The signed-in user, at the right end of the header: who you are, the way to
 * your account settings, and the sign-out. All other parts of the account are
 * on its pages in the settings modal. Open mode has no accounts. Thus, there it
 * renders nothing, not an empty menu.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const user = currentUser.value;
  if (!isServerMode || !user) return null;

  const name = user.displayName || user.username;

  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      panelClass={menuPanelClass}
      trigger={
        <Tooltip label={t("account.menu")}>
          <button
            type="button"
            class="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
            onClick={() => setOpen(!open)}
            aria-label={t("account.menu")}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Avatar
              name={name}
              color={user.avatarColor}
              class="w-7 h-7 text-xs"
            />
          </button>
        </Tooltip>
      }
    >
      <div class="flex items-center gap-3 px-3 pt-1.5 pb-2 max-w-72">
        <Avatar name={name} color={user.avatarColor} class="w-9 h-9 text-sm" />
        <div class="min-w-0">
          <p class="text-sm font-medium truncate">{name}</p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
            {user.email ?? user.username}
          </p>
        </div>
      </div>
      <div class={menuDividerClass} />
      <button
        type="button"
        class={menuItemClass}
        onClick={() => {
          setOpen(false);
          openSettings("account");
        }}
      >
        <UserCog class="w-4 h-4" />
        {t("account.settings")}
      </button>
      <button
        type="button"
        class={menuItemClass}
        onClick={async () => {
          setOpen(false);
          // The sign-out removes them from this device, which is the only place
          // where they are.
          const unsent = unsentNotes.peek().length;
          if (
            unsent > 0 &&
            !(await askConfirmation({
              title: plural("unsent.signOutTitle", unsent),
              body: t("unsent.signOutBody"),
              confirmLabel: t("login.signOut"),
            }))
          ) {
            return;
          }
          await signOut();
        }}
      >
        <LogOut class="w-4 h-4" />
        {t("login.signOut")}
      </button>
    </Dropdown>
  );
}
