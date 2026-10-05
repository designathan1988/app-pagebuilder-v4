// One region of the editor that cannot draw never takes the others with it (the audit's AUD-01: a status-bar text that
// could not be formatted unmounted the whole editor). A React error boundary (react.dev, "Catching rendering errors
// with an error boundary") around each region: what it caught goes to the incident feed, the region shows why it is
// empty, and it draws again at the next change of the store — a change is what could make it drawable again, and a
// region that throws again waits for the one after. Errors in event handlers and timers are not render errors: the
// window's own feed (errors.ts) takes those.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../../core/incidents.ts';
import { StoreContext, type EditorStore } from '../store.ts';
import { useT } from '../text.ts';

// The regions the shell draws, each a place the fallback takes (window.css)
type RegionId = 'top-bar' | 'activity-bar' | 'sidebar' | 'canvas' | 'right-dock' | 'dock' | 'inspector' | 'status-bar' | 'overlays' | 'preview';

interface Props {
  readonly region: RegionId;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

function RegionFallback({ region }: { readonly region: RegionId }) {
  const t = useT();
  return (
    <div className={`region-fallback region-fallback--${region}`} role="alert">
      {t('region.failed')}
    </div>
  );
}

export class RegionBoundary extends Component<Props, State> {
  static override contextType = StoreContext;
  declare context: EditorStore | null;
  override state: State = { failed: false };
  private unsubscribe: (() => void) | null = null;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidMount(): void {
    this.unsubscribe =
      this.context?.subscribe(() => {
        if (this.state.failed) this.setState({ failed: false });
      }) ?? null;
  }

  override componentWillUnmount(): void {
    this.unsubscribe?.();
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const what = error instanceof Error ? (error.stack ?? error.message) : String(error);
    reportError(`the ${this.props.region} region could not draw`, `${what}${info.componentStack ?? ''}`);
  }

  override render(): ReactNode {
    return this.state.failed ? <RegionFallback region={this.props.region} /> : this.props.children;
  }
}
