import { RPCHandler } from "@orpc/server/message-port";
import { ORPC_PORT_NAME } from "@/shared/orpc/constants";
import { router } from "@/shared/orpc/router";

const handler = new RPCHandler(router);

export default defineBackground(() => {
  browser.action?.onClicked.addListener((tab) => {
    void (async () => {
      try {
        const targetWindowId =
          tab.windowId ?? (await browser.windows.getLastFocused()).id ?? null;
        if (!targetWindowId) return;
        const url = new URL(browser.runtime.getURL("/window.html"));
        url.searchParams.set("targetWindowId", String(targetWindowId));
        await browser.windows.create({
          url: url.toString(),
          type: "popup",
          width: 520,
          height: 640,
          focused: true,
        });
      } catch (error) {
        console.warn("Failed to open resizer window", error);
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
