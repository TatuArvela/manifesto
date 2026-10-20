import { createContext } from "preact";

/**
 * The id of the label next to a control, given by a settings row. A shared
 * control names itself by it (`aria-labelledby`). Thus, a screen reader reads
 * the name of the setting with the control, not as a separate heading.
 */
export const ControlLabelId = createContext<string | undefined>(undefined);
