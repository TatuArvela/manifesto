import { LogOut, UserCog } from "lucide-preact";
import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import { currentUser, isServerMode, logout } from "../state/auth.js";
import { openSettings } from "../state/ui.js";
import { Avatar } from "./Avatar.js";
import { Dropdown } from "./Dropdown.js";
import { menuDividerClass, menuItemClass, menuPanelClass } from "./NoteMenu.js";
import { Tooltip } from "./Tooltip.js";

/**
 * The signed-in user, at the right end of the header: who you are, the way to
 * your account settings, and signing out. Everything else about the account
 * lives on its pages in the settings modal. Open mode has no accounts, so there
 * it renders nothing at all rather than an empty menu.
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
        onClick={() => {
          setOpen(false);
          void logout();
        }}
      >
        <LogOut class="w-4 h-4" />
        {t("login.signOut")}
      </button>
    </Dropdown>
  );
}
