import type { NoteColor } from "@manifesto/shared";
import type { LucideIcon } from "lucide-preact";
import {
  Archive,
  Bell,
  Image,
  Link2,
  ListChecks,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-preact";
import {
  getColorLabel,
  getColorPickerColors,
  plural,
  t,
} from "../i18n/index.js";
import {
  clearSearchFilters,
  type SearchLocation,
  type SearchType,
  searchColors,
  searchLocations,
  searchQuery,
  searchTypes,
  sortedNotes,
  toggleSearchColor,
  toggleSearchLocation,
  toggleSearchType,
} from "../state/index.js";

const TYPE_META: {
  key: SearchType;
  icon: LucideIcon;
  labelKey:
    | "search.type.reminders"
    | "search.type.checklists"
    | "search.type.images"
    | "search.type.urls";
}[] = [
  { key: "reminders", icon: Bell, labelKey: "search.type.reminders" },
  { key: "checklists", icon: ListChecks, labelKey: "search.type.checklists" },
  { key: "images", icon: Image, labelKey: "search.type.images" },
  { key: "urls", icon: Link2, labelKey: "search.type.urls" },
];

const LOCATION_META: {
  key: SearchLocation;
  icon: LucideIcon;
  labelKey:
    | "search.location.active"
    | "search.location.archived"
    | "search.location.trashed";
}[] = [
  { key: "active", icon: StickyNote, labelKey: "search.location.active" },
  { key: "archived", icon: Archive, labelKey: "search.location.archived" },
  { key: "trashed", icon: Trash2, labelKey: "search.location.trashed" },
];

function TypeChip({
  type,
  icon: Icon,
  label,
}: {
  type: SearchType;
  icon: LucideIcon;
  label: string;
}) {
  const selected = searchTypes.value.has(type);
  return (
    <button
      type="button"
      class={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full cursor-pointer transition-colors ${
        selected
          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400"
          : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
      }`}
      onClick={() => toggleSearchType(type)}
      aria-pressed={selected}
    >
      <Icon class="w-4 h-4" />
      {label}
    </button>
  );
}

function LocationChip({
  location,
  icon: Icon,
  label,
}: {
  location: SearchLocation;
  icon: LucideIcon;
  label: string;
}) {
  const selected = searchLocations.value.has(location);
  return (
    <button
      type="button"
      class={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full cursor-pointer transition-colors ${
        selected
          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400"
          : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
      }`}
      onClick={() => toggleSearchLocation(location)}
      aria-pressed={selected}
    >
      <Icon class="w-4 h-4" />
      {label}
    </button>
  );
}

function ColorChip({
  color,
  swatch,
  label,
}: {
  color: NoteColor;
  swatch: string;
  label: string;
}) {
  const selected = searchColors.value.has(color);
  return (
    <button
      type="button"
      class={`relative w-7 h-7 rounded-full cursor-pointer transition ${swatch} ${
        selected
          ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 ring-blue-500"
          : "hover:scale-110"
      }`}
      onClick={() => toggleSearchColor(color)}
      aria-label={label}
      aria-pressed={selected}
      title={label}
    />
  );
}

export function SearchView() {
  const locations = searchLocations.value;
  const locationsAtDefault = locations.size === 1 && locations.has("active");
  const filtersActive =
    searchQuery.value.length > 0 ||
    searchTypes.value.size > 0 ||
    searchColors.value.size > 0 ||
    !locationsAtDefault;
  const resultCount = sortedNotes.value.length;
  const colors = getColorPickerColors();

  return (
    <div class="mt-4 mb-6 flex flex-col gap-3">
      {/* Mobile-only search input (desktop uses the header's input). */}
      <div class="relative md:hidden">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="search"
          placeholder={t("header.searchPlaceholder")}
          class="w-full pl-10 pr-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-gray-900 outline-none transition text-sm"
          value={searchQuery.value}
          onInput={(e) => {
            searchQuery.value = (e.target as HTMLInputElement).value;
          }}
        />
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-1">
          {t("search.filterByType")}
        </span>
        {TYPE_META.map(({ key, icon, labelKey }) => (
          <TypeChip key={key} type={key} icon={icon} label={t(labelKey)} />
        ))}
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-1">
          {t("search.filterByColor")}
        </span>
        {colors.map((c) => (
          <ColorChip
            key={c.value}
            color={c.value as NoteColor}
            swatch={c.swatch}
            label={getColorLabel(c.value as NoteColor)}
          />
        ))}
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-1">
          {t("search.filterByLocation")}
        </span>
        {LOCATION_META.map(({ key, icon, labelKey }) => (
          <LocationChip
            key={key}
            location={key}
            icon={icon}
            label={t(labelKey)}
          />
        ))}
      </div>

      {filtersActive && (
        <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span>{plural("search.resultCount", resultCount)}</span>
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
            onClick={() => clearSearchFilters()}
          >
            <X class="w-3 h-3" />
            {t("search.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
