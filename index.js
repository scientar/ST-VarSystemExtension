import { renderExtensionTemplateAsync } from "/scripts/extensions.js";

const EXTENSION_NAMESPACE = "st-var-system";
const EXTENSION_LOG_PREFIX = "[ST-VarSystemExtension]";

function animateDrawer(element, shouldOpen) {
  const editor = window.EDITOR;
  if (editor?.slideToggle) {
    const options = {
      ...(editor.getSlideToggleOptions?.() ?? {}),
      onAnimationEnd: (el) => {
        el.closest(".drawer-content")?.classList.remove("resizing");
      },
    };
    element.classList.add("resizing");
    editor.slideToggle(element, options);
    return;
  }

  const $el = $(element);
  if (shouldOpen) {
    $el.stop(true, true).slideDown(200);
  } else {
    $el.stop(true, true).slideUp(200);
  }
}

function closeDrawer($icon, $content) {
  if (!$icon.hasClass("openIcon")) {
    return;
  }

  $icon.toggleClass("openIcon closedIcon");
  $content.toggleClass("openDrawer closedDrawer");
  animateDrawer($content.get(0), false);
}

function openDrawer($icon, $content) {
  if ($icon.hasClass("openIcon")) {
    return;
  }

  // 关闭其他已经打开的抽屉，保持与主题样式一致
  $(".drawer-icon.openIcon")
    .not($icon)
    .each((_, icon) => {
      const $otherIcon = $(icon);
      const $otherContent = $otherIcon
        .closest(".drawer")
        .find(".drawer-content")
        .first();
      closeDrawer($otherIcon, $otherContent);
    });

  $icon.toggleClass("closedIcon openIcon");
  $content.toggleClass("closedDrawer openDrawer");
  animateDrawer($content.get(0), true);
}

async function injectAppHeaderEntry() {
  if (document.querySelector("#var_system_drawer")) {
    return;
  }

  let templateHtml = null;
  try {
    templateHtml = await renderExtensionTemplateAsync(
      "third-party/ST-VarSystemExtension/assets/templates",
      "appHeaderVarSystemDrawer",
    );
  } catch (error) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} 模板 appHeaderVarSystemDrawer 加载失败`,
      error,
    );
    return;
  }

  if (!templateHtml) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} 模板 appHeaderVarSystemDrawer 返回空内容`,
    );
    return;
  }

  const $drawer = $(templateHtml);
  const $anchor = $("#extensions-settings-button");
  if ($anchor.length === 0) {
    console.warn(`${EXTENSION_LOG_PREFIX} 找不到扩展设置按钮，无法插入入口`);
    return;
  }

  $anchor.after($drawer);

  const $icon = $drawer.find("#var_system_drawer_icon");
  const $content = $drawer.find("#var_system_drawer_content");

  $content.hide();

  $drawer.find(".drawer-toggle").on("click", () => {
    if ($icon.hasClass("openIcon")) {
      closeDrawer($icon, $content);
    } else {
      openDrawer($icon, $content);
    }
  });

  $("#var_system_open_dashboard").on("click", () => {
    console.log(`${EXTENSION_LOG_PREFIX} 打开面板`);
  });

  $("#var_system_open_settings").on("click", () => {
    console.log(`${EXTENSION_LOG_PREFIX} 打开设置`);
  });

  console.log(`${EXTENSION_LOG_PREFIX} 自定义入口已注入`);
}

async function initExtension() {
  console.log(`${EXTENSION_LOG_PREFIX} (${EXTENSION_NAMESPACE}) 初始化`);
  await injectAppHeaderEntry();
}

async function shutdownExtension() {
  console.log(`${EXTENSION_LOG_PREFIX} 卸载`);
}

// 允许外部在需要时显式调用
window.STVarSystemExtension = {
  init: initExtension,
  exit: shutdownExtension,
};

// 自动初始化
$(async () => {
  try {
    await initExtension();
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 初始化失败`, error);
  }
});
