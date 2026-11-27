/**
 * What every analysis panel reads from the page: the state, the strings, the
 * selected component, the ground name and the figure builder. The page builds
 * it on each render; panels never read the DOM.
 */
import type { Figure } from "../bode";
import type { Strings } from "../i18n";
import type { State } from "../state";

export interface PanelContext {
  state: State;
  t: Strings;
  /** Id of the component selected on the schematic, if any. */
  selected: string | undefined;
  /** Name of the ground node of the current circuit. */
  ground: string;
  /** Builds a plot and registers it for the cursor. */
  figure: Figure;
}
