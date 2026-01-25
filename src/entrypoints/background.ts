import { RPCHandler } from "@orpc/server/message-port";
import { ORPC_PORT_NAME } from "@/shared/orpc/constants";
import { router } from "@/shared/orpc/router";

const handler = new RPCHandler(router);
const RESIZER_WINDOW_ID_KEY = "resizerWindowId";

const getStoredResizerWindowId = async () => {
  try {
    if (!browser?.storage?.local) return null;
    const stored = await browser.storage.local.get(RESIZER_WINDOW_ID_KEY);
    const value = stored[RESIZER_WINDOW_ID_KEY];
    return typeof value === "number" ? value : null;
  } catch (error) {
    console.warn("Failed to read resizer window id", error);
    return null;
  }
};

const focusExistingResizerWindow = async () => {
  const storedId = await getStoredResizerWindowId();
  if (!storedId) return false;
  try {
    const existingWindow = await browser.windows.get(storedId);
    if (!existingWindow?.id) return false;
    const updateInfo: browser.windows.UpdateInfo = { focused: true };
    if (existingWindow.state === "minimized") updateInfo.state = "normal";
    await browser.windows.update(existingWindow.id, updateInfo);
    return true;
  } catch (error) {
    console.warn("Stored resizer window not found", error);
    try {
      await browser.storage.local.remove(RESIZER_WINDOW_ID_KEY);
    } catch (removeError) {
      console.warn("Failed to clear resizer window id", removeError);
    }
    return false;
  }
};

export default defineBackground(() => {
  browser.action?.onClicked.addListener((tab) => {
    void (async () => {
      try {
        const focused = await focusExistingResizerWindow();
        if (focused) return;
        const targetWindowId =
          tab.windowId ?? (await browser.windows.getLastFocused()).id ?? null;
        if (!targetWindowId) return;
        const url = new URL(browser.runtime.getURL("/window.html"));
        url.searchParams.set("targetWindowId", String(targetWindowId));
        const createdWindow = await browser.windows.create({
          url: url.toString(),
          type: "popup",
          width: 520,
          height: 640,
          focused: true,
        });
        if (createdWindow?.id && browser?.storage?.local) {
          await browser.storage.local.set({
            [RESIZER_WINDOW_ID_KEY]: createdWindow.id,
          });
        }
      } catch (error) {
        console.warn("Failed to open resizer window", error);
      }
    })();
  });

  browser.windows?.onRemoved?.addListener((windowId) => {
    void (async () => {
      try {
        const stored = await browser.storage.local.get(RESIZER_WINDOW_ID_KEY);
        if (stored[RESIZER_WINDOW_ID_KEY] === windowId) {
          await browser.storage.local.remove(RESIZER_WINDOW_ID_KEY);
        }
      } catch (error) {
        console.warn("Failed to clear resizer window id on close", error);
      }
    })();
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== ORPC_PORT_NAME) return;
    if (port.sender?.id !== browser.runtime.id) {
      console.warn("[oRPC] rejected port", {
        name: port.name,
        sender: port.sender,
      });
      port.disconnect();
      return;
    }
    handler.upgrade(port);
  });

  console.log("oRPC background ready", { id: browser.runtime.id });
});
