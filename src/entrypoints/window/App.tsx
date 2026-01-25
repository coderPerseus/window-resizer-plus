import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./App.css";

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type DisplayInfo = {
  id: string;
  bounds: { left: number; top: number; width: number; height: number };
  workArea: { left: number; top: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
};

type RatioOption = {
  label: string;
  value: string;
  ratio: number | null;
};

type RatioOptionDefinition = Omit<RatioOption, "label"> & {
  labelKey?: "free" | "custom";
};

type StatusState = {
  key: "missingWindow" | "applied" | "applyFailed";
  detail?: { windowSize: string; systemSize: string };
} | null;

type Language = "zh" | "en";

const CLOSE_ON_APPLY_KEY = "closeOnApply";

const ratioOptionDefinitions: RatioOptionDefinition[] = [
  { value: "free", ratio: null, labelKey: "free" },
  { value: "1:1", ratio: 1 },
  { value: "4:3", ratio: 4 / 3 },
  { value: "3:2", ratio: 3 / 2 },
  { value: "5:4", ratio: 5 / 4 },
  { value: "7:5", ratio: 7 / 5 },
  { value: "16:9", ratio: 16 / 9 },
  { value: "9:16", ratio: 9 / 16 },
  { value: "4:5", ratio: 4 / 5 },
  { value: "3:4", ratio: 3 / 4 },
  { value: "2:3", ratio: 2 / 3 },
  { value: "custom", ratio: null, labelKey: "custom" },
];

const translations = {
  zh: {
    buttons: {
      apply: "应用",
      applying: "应用中...",
    },
    labels: {
      ratioSelect: "比例选择",
      customRatioWidth: "自定义比例宽度",
      customRatioHeight: "自定义比例高度",
    },
    hints: {
      dragResize: "窗口调整框，拖拽移动，拉伸缩放",
    },
    ratioOptions: {
      free: "自由比例",
      custom: "自定义比例",
    },
    ratioChip: {
      customPrefix: "自定义",
      freeFallback: "自由比例",
    },
    status: {
      missingWindow: "未找到需要调整的窗口",
      applyFailed: "应用失败，请重试",
      applied: (detail: { windowSize: string; systemSize: string }) =>
        `已应用：${detail.windowSize} / ${detail.systemSize}`,
    },
    languageToggle: {
      labelEnglish: "EN",
      labelChinese: "ZH",
      toEnglish: "切换到英文",
      toChinese: "切换到中文",
    },
    closeOnApply: {
      title: "应用后关闭",
      description: "点击应用后自动关闭此窗口",
      ariaLabel: "应用后自动关闭调整窗口",
    },
  },
  en: {
    buttons: {
      apply: "Apply",
      applying: "Applying...",
    },
    labels: {
      ratioSelect: "Aspect ratio",
      customRatioWidth: "Custom ratio width",
      customRatioHeight: "Custom ratio height",
    },
    hints: {
      dragResize: "Drag to move, resize to scale the window frame",
    },
    ratioOptions: {
      free: "Free ratio",
      custom: "Custom ratio",
    },
    ratioChip: {
      customPrefix: "Custom",
      freeFallback: "Free ratio",
    },
    status: {
      missingWindow: "No window found to resize",
      applyFailed: "Failed to apply. Please try again.",
      applied: (detail: { windowSize: string; systemSize: string }) =>
        `Applied: ${detail.windowSize} / ${detail.systemSize}`,
    },
    languageToggle: {
      labelEnglish: "EN",
      labelChinese: "ZH",
      toEnglish: "Switch to English",
      toChinese: "Switch to Chinese",
    },
    closeOnApply: {
      title: "Close on apply",
      description: "Automatically close this window after applying",
      ariaLabel: "Automatically close the resize window after applying",
    },
  },
} as const;

const isChineseLanguage = (language: string | undefined | null) =>
  Boolean(language && language.toLowerCase().startsWith("zh"));

const getDefaultLanguage = (): Language => {
  if (typeof navigator === "undefined") return "zh";
  const languages =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  return languages.some(isChineseLanguage) ? "zh" : "en";
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatSize = (rect: Rect | null) => {
  if (!rect) return "-";
  return `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
};

const toRect = (data: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}) => ({
  left: data.left ?? 0,
  top: data.top ?? 0,
  width: data.width ?? 0,
  height: data.height ?? 0,
});

const pickDisplayForWindow = (
  displays: DisplayInfo[],
  windowRect: Rect | null,
): DisplayInfo | null => {
  if (!displays.length) return null;
  if (windowRect) {
    const match = displays.find((display) => {
      const { left, top, width, height } = display.bounds;
      return (
        windowRect.left >= left &&
        windowRect.left < left + width &&
        windowRect.top >= top &&
        windowRect.top < top + height
      );
    });
    if (match) return match;
  }
  return displays.find((display) => display.isPrimary) ?? displays[0] ?? null;
};

const fitRectToDisplay = (rect: Rect, display: Rect, ratio: number | null) => {
  let nextWidth = rect.width;
  let nextHeight = rect.height;

  if (ratio) {
    nextHeight = nextWidth / ratio;
    if (nextHeight > display.height) {
      nextHeight = display.height;
      nextWidth = nextHeight * ratio;
    }
  }

  nextWidth = clamp(nextWidth, 120, display.width);
  nextHeight = clamp(nextHeight, 100, display.height);

  const nextLeft = clamp(rect.left, 0, display.width - nextWidth);
  const nextTop = clamp(rect.top, 0, display.height - nextHeight);

  return {
    left: nextLeft,
    top: nextTop,
    width: nextWidth,
    height: nextHeight,
  };
};

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<{
    mode: "drag" | "resize";
    startX: number;
    startY: number;
    startRect: Rect;
  } | null>(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [systemRect, setSystemRect] = useState<Rect | null>(null);
  const [virtualRect, setVirtualRect] = useState<Rect | null>(null);
  const [selectedRatio, setSelectedRatio] = useState("free");
  const [customRatioWidth, setCustomRatioWidth] = useState("16");
  const [customRatioHeight, setCustomRatioHeight] = useState("9");
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return getDefaultLanguage();
    } catch {
      return "zh";
    }
  });
  const [status, setStatus] = useState<StatusState>(null);
  const [closeOnApply, setCloseOnApply] = useState(true);
  const [targetWindowId] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("targetWindowId");
    if (!idParam) return null;
    const parsed = Number(idParam);
    return Number.isFinite(parsed) ? parsed : null;
  });
  const [isApplying, setIsApplying] = useState(false);
  const isMac = useMemo(
    () => /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform),
    [],
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (!browser?.storage?.local) return;
        const stored = await browser.storage.local.get(CLOSE_ON_APPLY_KEY);
        const value = stored[CLOSE_ON_APPLY_KEY];
        if (!active) return;
        if (typeof value === "boolean") setCloseOnApply(value);
      } catch (error) {
        console.warn("Failed to load close-on-apply config", error);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const customRatioValue = useMemo(() => {
    const width = Number(customRatioWidth);
    const height = Number(customRatioHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return width / height;
  }, [customRatioHeight, customRatioWidth]);

  const selectedRatioValue = useMemo(() => {
    if (selectedRatio === "custom") return customRatioValue;
    return (
      ratioOptionDefinitions.find((option) => option.value === selectedRatio)
        ?.ratio ?? null
    );
  }, [customRatioValue, selectedRatio]);

  const localizedRatioOptions = useMemo<RatioOption[]>(
    () =>
      ratioOptionDefinitions.map((option) => ({
        ...option,
        label: option.labelKey
          ? translations[language].ratioOptions[option.labelKey]
          : option.value,
      })),
    [language],
  );

  const t = translations[language];

  const ratioChipLabel = useMemo(() => {
    if (selectedRatio === "custom" && customRatioValue) {
      return `${t.ratioChip.customPrefix} ${customRatioWidth}:${customRatioHeight}`;
    }
    const option = localizedRatioOptions.find(
      (item) => item.value === selectedRatio,
    );
    return option?.label ?? t.ratioChip.freeFallback;
  }, [
    customRatioHeight,
    customRatioValue,
    customRatioWidth,
    localizedRatioOptions,
    selectedRatio,
    t.ratioChip,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const resolvedId =
          targetWindowId ?? (await browser.windows.getCurrent()).id ?? null;
        if (!resolvedId) return;
        const windowInfo = await browser.windows.get(resolvedId);
        const windowRect = toRect(windowInfo);
        const displays = browser.system?.display
          ? await browser.system.display.getInfo()
          : [];
        const display = pickDisplayForWindow(
          displays as any as DisplayInfo[],
          windowRect,
        );

        if (!active) return;

        if (display) {
          const boundsRect = toRect(display.bounds);
          const relativeWindowRect = {
            ...windowRect,
            left: windowRect.left - boundsRect.left,
            top: windowRect.top - boundsRect.top,
          };
          setSystemRect(boundsRect);
          setVirtualRect(
            fitRectToDisplay(relativeWindowRect, boundsRect, null),
          );
        } else {
          const fallbackRect = {
            left: 0,
            top: 0,
            width: window.screen.width,
            height: window.screen.height,
          };
          setSystemRect(fallbackRect);
          setVirtualRect(fitRectToDisplay(windowRect, fallbackRect, null));
        }
      } catch (error) {
        console.warn("Failed to load window info", error);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [targetWindowId]);

  useEffect(() => {
    if (!systemRect || !selectedRatioValue) return;
    setVirtualRect((current) => {
      if (!current) return current;
      const next = {
        ...current,
        height: current.width / selectedRatioValue,
      };
      return fitRectToDisplay(next, systemRect, selectedRatioValue);
    });
  }, [selectedRatioValue, systemRect]);

  const displayWidth = systemRect?.width ?? 0;
  const displayHeight = systemRect?.height ?? 0;
  const scale = useMemo(() => {
    if (!systemRect || !containerWidth) return 1;
    const maxHeight = 260;
    return Math.min(
      containerWidth / systemRect.width,
      maxHeight / systemRect.height,
    );
  }, [containerWidth, systemRect]);

  const scaledWidth = displayWidth * scale;
  const scaledHeight = displayHeight * scale;

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    mode: "drag" | "resize",
  ) => {
    if (!virtualRect || !systemRect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...virtualRect },
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactionRef.current || !virtualRect || !systemRect) return;
    const { startX, startY, startRect, mode } = interactionRef.current;
    const dx = (event.clientX - startX) / scale;
    const dy = (event.clientY - startY) / scale;

    if (mode === "drag") {
      const nextLeft = clamp(
        startRect.left + dx,
        0,
        systemRect.width - startRect.width,
      );
      const nextTop = clamp(
        startRect.top + dy,
        0,
        systemRect.height - startRect.height,
      );
      setVirtualRect({ ...startRect, left: nextLeft, top: nextTop });
      return;
    }

    const minWidth = 160;
    const minHeight = 120;
    let nextWidth = startRect.width + dx;
    let nextHeight = startRect.height + dy;

    if (selectedRatioValue) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        nextWidth = startRect.width + dx;
        nextWidth = clamp(
          nextWidth,
          minWidth,
          systemRect.width - startRect.left,
        );
        nextHeight = nextWidth / selectedRatioValue;
      } else {
        nextHeight = startRect.height + dy;
        nextHeight = clamp(
          nextHeight,
          minHeight,
          systemRect.height - startRect.top,
        );
        nextWidth = nextHeight * selectedRatioValue;
      }

      if (nextWidth > systemRect.width - startRect.left) {
        nextWidth = systemRect.width - startRect.left;
        nextHeight = nextWidth / selectedRatioValue;
      }
      if (nextHeight > systemRect.height - startRect.top) {
        nextHeight = systemRect.height - startRect.top;
        nextWidth = nextHeight * selectedRatioValue;
      }
    }

    nextWidth = clamp(nextWidth, minWidth, systemRect.width - startRect.left);
    nextHeight = clamp(
      nextHeight,
      minHeight,
      systemRect.height - startRect.top,
    );

    setVirtualRect({
      ...startRect,
      width: nextWidth,
      height: nextHeight,
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactionRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    interactionRef.current = null;
  };

  const applyWindow = async () => {
    if (!virtualRect || !systemRect) return;
    if (targetWindowId === null) {
      setStatus({ key: "missingWindow" });
      return;
    }
    setIsApplying(true);
    setStatus(null);
    try {
      await browser.windows.update(targetWindowId, {
        left: Math.round(virtualRect.left + systemRect.left),
        top: Math.round(virtualRect.top + systemRect.top),
        width: Math.round(virtualRect.width),
        height: Math.round(virtualRect.height),
        focused: true,
      });
      setStatus({
        key: "applied",
        detail: {
          windowSize: formatSize(virtualRect),
          systemSize: formatSize(systemRect),
        },
      });
      if (closeOnApply) {
        try {
          const currentTab = await browser?.tabs?.getCurrent?.();
          if (currentTab?.id !== undefined && browser?.tabs?.remove) {
            await browser.tabs.remove(currentTab.id);
            return;
          }
        } catch (error) {
          console.warn("Failed to close current tab", error);
        }

        try {
          const currentWindow = await browser?.windows?.getCurrent?.();
          if (
            currentWindow?.id !== undefined &&
            browser?.windows?.remove &&
            currentWindow.id !== targetWindowId &&
            currentWindow.type &&
            currentWindow.type !== "normal"
          ) {
            await browser.windows.remove(currentWindow.id);
            return;
          }
        } catch (error) {
          console.warn("Failed to close current window", error);
        }

        try {
          window.close();
        } catch (error) {
          console.warn("Failed to close popup", error);
        }
      }
    } catch (error) {
      console.warn("Failed to apply window size", error);
      setStatus({ key: "applyFailed" });
    } finally {
      setIsApplying(false);
    }
  };

  const languageToggleLabel =
    language === "zh"
      ? t.languageToggle.labelEnglish
      : t.languageToggle.labelChinese;
  const languageToggleAriaLabel =
    language === "zh" ? t.languageToggle.toEnglish : t.languageToggle.toChinese;

  const handleCloseToggle = (next: boolean) => {
    setCloseOnApply(next);
    void browser?.storage?.local
      ?.set({ [CLOSE_ON_APPLY_KEY]: next })
      .catch((error) => {
        console.warn("Failed to persist close-on-apply config", error);
      });
  };

  return (
    <div className="app">
      <div
        className="close-toggle"
        role="group"
        aria-label={t.closeOnApply.ariaLabel}
      >
        <label className="close-toggle-control">
          <input
            type="checkbox"
            className="close-toggle-input"
            checked={closeOnApply}
            onChange={(event) => handleCloseToggle(event.target.checked)}
            aria-label={t.closeOnApply.ariaLabel}
          />
          <span className="close-toggle-switch" aria-hidden="true" />
          <span className="close-toggle-desc">
            {t.closeOnApply.description}
          </span>
        </label>
      </div>
      <button
        type="button"
        className="lang-toggle"
        onClick={() =>
          setLanguage((current) => (current === "zh" ? "en" : "zh"))
        }
        aria-label={languageToggleAriaLabel}
      >
        {languageToggleLabel}
      </button>
      <header className="top-bar">
        <div className="app-title">
          <span className="app-name">Window Resizer Plus</span>
        </div>
        <button
          type="button"
          className="apply-button"
          onClick={applyWindow}
          disabled={!virtualRect || !systemRect || isApplying}
        >
          {isApplying ? t.buttons.applying : t.buttons.apply}
        </button>
      </header>

      <section className="resize-panel">
        <div className="preview-area" ref={containerRef}>
          <div
            className="screen"
            style={{ width: scaledWidth, height: scaledHeight }}
          >
            {virtualRect ? (
              <div
                className="window-rect"
                style={{
                  left: virtualRect.left * scale,
                  top: virtualRect.top * scale,
                  width: virtualRect.width * scale,
                  height: virtualRect.height * scale,
                }}
                onPointerDown={(event) => handlePointerDown(event, "drag")}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <div className="window-header">
                  <div className="window-header-left">
                    {isMac ? (
                      <div className="window-controls mac" aria-hidden="true">
                        <span className="dot close" />
                        <span className="dot minimize" />
                        <span className="dot zoom" />
                      </div>
                    ) : null}
                  </div>
                  <div className="window-header-right">
                    {!isMac ? (
                      <div className="window-controls win" aria-hidden="true">
                        <span className="win-control minimize" />
                        <span className="win-control maximize" />
                        <span className="win-control close" />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div
                  className="resize-handle"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    handlePointerDown(event, "resize");
                  }}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                />
              </div>
            ) : null}
          </div>
        </div>
        <p
          style={{
            textAlign: "center",
            color: "#545454",
          }}
        >
          {t.hints.dragResize}
        </p>
      </section>

      <footer className="bottom-bar">
        <div className="ratio-panel">
          <label className="ratio-label" htmlFor="ratio-select">
            {t.labels.ratioSelect}
          </label>
          <select
            id="ratio-select"
            className="ratio-select"
            value={selectedRatio}
            onChange={(event) => setSelectedRatio(event.target.value)}
          >
            {localizedRatioOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {selectedRatio === "custom" ? (
            <div className="custom-ratio">
              <input
                type="number"
                min={1}
                step={1}
                value={customRatioWidth}
                onChange={(event) => setCustomRatioWidth(event.target.value)}
                aria-label={t.labels.customRatioWidth}
              />
              <span>:</span>
              <input
                type="number"
                min={1}
                step={1}
                value={customRatioHeight}
                onChange={(event) => setCustomRatioHeight(event.target.value)}
                aria-label={t.labels.customRatioHeight}
              />
            </div>
          ) : null}
        </div>
        <div className="size-summary">
          <span>{formatSize(virtualRect)}</span>
          <span className="size-divider">/</span>
          <span>{formatSize(systemRect)}</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
