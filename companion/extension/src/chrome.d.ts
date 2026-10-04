// The few chrome.* APIs the extension calls (https://developer.chrome.com/docs/extensions/reference/api), declared here
// so the extension needs no package of its own.
declare namespace chrome {
  namespace tabs {
    interface Tab {
      readonly id?: number;
      readonly url?: string;
    }
    function query(query: { readonly active?: boolean; readonly currentWindow?: boolean }): Promise<Tab[]>;
  }
  namespace scripting {
    interface InjectionResult<T> {
      readonly result?: T;
    }
    function executeScript<A extends unknown[], R>(injection: { readonly target: { readonly tabId: number }; readonly func: (...args: A) => R; readonly args?: A }): Promise<InjectionResult<Awaited<R>>[]>;
  }
  namespace storage {
    const local: {
      get(keys: readonly string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  }
  namespace action {
    const onClicked: { addListener(listener: (tab: tabs.Tab) => void): void };
    function setBadgeText(details: { readonly text: string; readonly tabId?: number | undefined }): Promise<void>;
    function setTitle(details: { readonly title: string; readonly tabId?: number | undefined }): Promise<void>;
  }
}
