import { createContext } from "preact";

/**
 * The id of the label a control sits beside, given by a settings row. A
 * shared control names itself by it (`aria-labelledby`), so a screen reader
 * reads the setting's name with the control rather than as a heading apart.
 */
export const ControlLabelId = createContext<string | undefined>(undefined);
