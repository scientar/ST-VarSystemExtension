/**
 * 按钮 Loading 状态管理器
 * 为按钮添加加载、成功、错误等状态
 */

export enum ButtonState {
  IDLE = 'idle',
  LOADING = 'loading',
  SUCCESS = 'success',
  ERROR = 'error',
}

interface ButtonStateConfig {
  icon: string;
  text?: string;
  disabled?: boolean;
}

const STATE_CONFIGS: Record<ButtonState, ButtonStateConfig> = {
  [ButtonState.IDLE]: {
    icon: '',
    disabled: false,
  },
  [ButtonState.LOADING]: {
    icon: 'fa-spinner fa-spin',
    disabled: true,
  },
  [ButtonState.SUCCESS]: {
    icon: 'fa-check',
    disabled: true,
  },
  [ButtonState.ERROR]: {
    icon: 'fa-times',
    disabled: false,
  },
};

export class ButtonLoader {
  private $button: JQuery;
  private originalContent: string;
  private currentState: ButtonState;
  private originalText?: string;

  constructor($button: JQuery) {
    this.$button = $button;
    this.originalContent = $button.html();
    this.currentState = ButtonState.IDLE;

    // 提取原始文本（如果有）
    const $textNode = $button.find('span').last();
    if ($textNode.length > 0) {
      this.originalText = $textNode.text();
    }
  }

  /**
   * 设置按钮状态
   * @param state 状态
   * @param customText 自定义文本
   */
  setState(state: ButtonState, customText?: string) {
    this.currentState = state;
    const config = STATE_CONFIGS[state];

    // 保存原始内容（仅第一次）
    if (state === ButtonState.LOADING && this.currentState === ButtonState.IDLE) {
      this.originalContent = this.$button.html();
    }

    // 更新按钮内容
    this.updateButtonContent(config, customText);

    // 更新禁用状态
    this.$button.prop('disabled', config.disabled || false);

    // 添加状态类
    this.$button
      .removeClass('btn-idle btn-loading btn-success btn-error')
      .addClass(`btn-${state}`);
  }

  /**
   * 显示加载状态
   * @param text 加载文本
   */
  showLoading(text: string = '加载中...') {
    this.setState(ButtonState.LOADING, text);
  }

  /**
   * 显示成功状态
   * @param text 成功文本
   * @param duration 自动恢复时间（毫秒），0表示不自动恢复
   */
  showSuccess(text: string = '成功', duration: number = 2000) {
    this.setState(ButtonState.SUCCESS, text);

    if (duration > 0) {
      setTimeout(() => {
        this.reset();
      }, duration);
    }
  }

  /**
   * 显示错误状态
   * @param text 错误文本
   * @param duration 自动恢复时间（毫秒），0表示不自动恢复
   */
  showError(text: string = '失败', duration: number = 2000) {
    this.setState(ButtonState.ERROR, text);

    if (duration > 0) {
      setTimeout(() => {
        this.reset();
      }, duration);
    }
  }

  /**
   * 重置按钮到初始状态
   */
  reset() {
    this.$button
      .removeClass('btn-idle btn-loading btn-success btn-error')
      .addClass('btn-idle')
      .prop('disabled', false)
      .html(this.originalContent);

    this.currentState = ButtonState.IDLE;
  }

  /**
   * 获取当前状态
   */
  getState(): ButtonState {
    return this.currentState;
  }

  /**
   * 更新按钮内容
   */
  private updateButtonContent(config: ButtonStateConfig, customText?: string) {
    const iconClass = config.icon ? `fa-solid ${config.icon}` : '';
    const text = customText || config.text || this.originalText || '';

    let html = '';
    if (iconClass && text) {
      html = `<i class="${iconClass}"></i> <span>${text}</span>`;
    } else if (iconClass) {
      html = `<i class="${iconClass}"></i>`;
    } else if (text) {
      html = `<span>${text}</span>`;
    }

    this.$button.html(html);
  }

  /**
   * 便捷方法：包装异步操作
   * @param asyncFn 异步函数
   * @param loadingText 加载文本
   * @param successText 成功文本
   * @param errorText 错误文本
   */
  async wrapAsync<T>(
    asyncFn: () => Promise<T>,
    options: {
      loadingText?: string;
      successText?: string;
      errorText?: string;
      successDuration?: number;
      errorDuration?: number;
    } = {},
  ): Promise<T | null> {
    try {
      this.showLoading(options.loadingText);
      const result = await asyncFn();
      this.showSuccess(options.successText, options.successDuration);
      return result;
    } catch (error) {
      this.showError(options.errorText, options.errorDuration);
      throw error;
    }
  }
}

/**
 * 静态工具方法：快速创建 ButtonLoader
 * @param selector 按钮选择器
 */
export function createButtonLoader(selector: string | JQuery): ButtonLoader {
  const $button = typeof selector === 'string' ? $(selector) : selector;
  return new ButtonLoader($button);
}

/**
 * 为按钮添加多状态支持的HTML结构
 * 使用 data 属性定义各状态的文本
 *
 * @example
 * <button
 *   id="save-btn"
 *   class="menu_button"
 *   data-idle-text="保存"
 *   data-loading-text="保存中..."
 *   data-success-text="保存成功"
 *   data-error-text="保存失败"
 * >
 *   <i class="fa-solid fa-save"></i>
 *   <span>保存</span>
 * </button>
 */
export class DataButtonLoader extends ButtonLoader {
  constructor($button: JQuery) {
    super($button);
  }

  override showLoading(text?: string) {
    const loadingText = text || this.$button.data('loading-text') || '加载中...';
    super.showLoading(loadingText);
  }

  override showSuccess(text?: string, duration: number = 2000) {
    const successText = text || this.$button.data('success-text') || '成功';
    super.showSuccess(successText, duration);
  }

  override showError(text?: string, duration: number = 2000) {
    const errorText = text || this.$button.data('error-text') || '失败';
    super.showError(errorText, duration);
  }

  private $button: JQuery;
}

/**
 * 创建基于 data 属性的 ButtonLoader
 * @param selector 按钮选择器
 */
export function createDataButtonLoader(
  selector: string | JQuery,
): DataButtonLoader {
  const $button = typeof selector === 'string' ? $(selector) : selector;
  return new DataButtonLoader($button);
}
