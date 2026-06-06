import {
  Injectable,
  ComponentRef,
  Injector,
  ApplicationRef,
  createComponent,
  EnvironmentInjector,
} from "@angular/core";
import { BaseTerminalTabComponent } from "tabby-terminal";
import { AIPanelComponent } from "../components/agent_panel";

@Injectable()
export class AIAgentPanelService {
  private panelRefs = new Map<
    BaseTerminalTabComponent<any>,
    ComponentRef<AIPanelComponent>
  >();
  private panelVisible = new Map<BaseTerminalTabComponent<any>, boolean>();
  private layoutObservers = new Map<
    BaseTerminalTabComponent<any>,
    {
      mutationObserver: MutationObserver;
      resizeObserver?: ResizeObserver;
    }
  >();

  constructor(
    private appRef: ApplicationRef,
    private injector: Injector,
    private envInjector: EnvironmentInjector,
  ) {}

  toggle(terminal: BaseTerminalTabComponent<any>): void {
    const isVisible = this.panelVisible.get(terminal) ?? false;
    if (isVisible) {
      this.hide(terminal);
    } else {
      this.show(terminal);
    }
  }

  show(terminal: BaseTerminalTabComponent<any>): void {
    if (this.panelRefs.has(terminal)) {
      const ref = this.panelRefs.get(terminal)!;
      ref.location.nativeElement.style.display = "flex";
      this.ensureLayoutObserver(terminal);
      this.syncPanelBounds(terminal);
      this.panelVisible.set(terminal, true);
      this.updateTerminalLayout(terminal, true);
      return;
    }

    const panelRef = createComponent(AIPanelComponent, {
      environmentInjector: this.envInjector,
      elementInjector: this.injector,
    });
    panelRef.instance.frontend = terminal.frontend;
    panelRef.instance.terminal = terminal;
    panelRef.instance.closed.subscribe(() => {
      this.hide(terminal);
    });

    const hostElement = terminal.element.nativeElement as HTMLElement;
    const panelElement = panelRef.location.nativeElement as HTMLElement;
    const widthPercent = 40;

    panelElement.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            width: ${widthPercent}%;
            height: 100%;
            z-index: 100;
            display: flex;
            flex-direction: column;
            pointer-events: auto;
            background: var(--theme-bg);
        `;

    hostElement.appendChild(panelElement);
    this.appRef.attachView(panelRef.hostView);
    this.panelRefs.set(terminal, panelRef);
    this.ensureLayoutObserver(terminal);
    this.syncPanelBounds(terminal);
    this.panelVisible.set(terminal, true);
    this.updateTerminalLayout(terminal, true);
    panelRef.changeDetectorRef.detectChanges();
  }

  hide(terminal: BaseTerminalTabComponent<any>): void {
    const ref = this.panelRefs.get(terminal);
    if (ref) {
      ref.location.nativeElement.style.display = "none";
    }
    this.panelVisible.set(terminal, false);
    this.updateTerminalLayout(terminal, false);
    terminal.frontend?.focus();
  }

  detach(terminal: BaseTerminalTabComponent<any>): void {
    this.destroyLayoutObserver(terminal);
    const ref = this.panelRefs.get(terminal);
    if (ref) {
      this.appRef.detachView(ref.hostView);
      ref.destroy();
      this.panelRefs.delete(terminal);
    }
    this.panelVisible.delete(terminal);
  }

  private updateTerminalLayout(
    terminal: BaseTerminalTabComponent<any>,
    panelVisible: boolean,
  ): void {
    if (panelVisible) {
      this.syncPanelBounds(terminal);
    }

    const contentEl = terminal.element.nativeElement.querySelector(
      ".content",
    ) as HTMLElement | null;
    if (contentEl) {
      if (panelVisible) {
        const widthPercent = 40;
        contentEl.style.width = `${100 - widthPercent}%`;
      } else {
        contentEl.style.width = "100%";
      }
    }

    setTimeout(() => {
      const frontend = terminal.frontend as any;
      if (frontend?.resizeHandler) {
        frontend.resizeHandler();
      }
    }, 100);
  }

  private ensureLayoutObserver(terminal: BaseTerminalTabComponent<any>): void {
    if (this.layoutObservers.has(terminal)) {
      return;
    }

    const hostElement = terminal.element.nativeElement as HTMLElement;
    let syncQueued = false;
    const scheduleSync = () => {
      if (syncQueued) {
        return;
      }
      syncQueued = true;
      requestAnimationFrame(() => {
        syncQueued = false;
        this.syncPanelBounds(terminal);
      });
    };

    const mutationObserver = new MutationObserver(scheduleSync);
    mutationObserver.observe(hostElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleSync);
      resizeObserver.observe(hostElement);
    }

    this.layoutObservers.set(terminal, {
      mutationObserver,
      resizeObserver,
    });
  }

  private destroyLayoutObserver(terminal: BaseTerminalTabComponent<any>): void {
    const observers = this.layoutObservers.get(terminal);
    if (!observers) {
      return;
    }

    observers.mutationObserver.disconnect();
    observers.resizeObserver?.disconnect();
    this.layoutObservers.delete(terminal);
  }

  private syncPanelBounds(terminal: BaseTerminalTabComponent<any>): void {
    const panelRef = this.panelRefs.get(terminal);
    if (!panelRef) {
      return;
    }

    const panelElement = panelRef.location.nativeElement as HTMLElement;
    const hostElement = terminal.element.nativeElement as HTMLElement;
    const toolbarOffset = this.getToolbarOffset(hostElement);

    panelElement.style.top = `${toolbarOffset}px`;
    panelElement.style.height =
      toolbarOffset > 0 ? `calc(100% - ${toolbarOffset}px)` : "100%";
  }

  private getToolbarOffset(hostElement: HTMLElement): number {
    const spacerElements = hostElement.querySelectorAll(
      ".terminal-toolbar-spacer",
    );

    return Array.from(spacerElements).reduce((height, element) => {
      const spacerHeight = (element as HTMLElement).getBoundingClientRect()
        .height;
      return Math.max(height, spacerHeight);
    }, 0);
  }
}
