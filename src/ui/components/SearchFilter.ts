/**
 * 函数库搜索和过滤组件
 */

interface FilterOptions {
  searchTerm: string;
  type: string; // 'active' | 'passive' | ''
  status: string; // 'enabled' | 'disabled' | 'builtin' | ''
}

export class FunctionSearchFilter {
  private $searchInput: JQuery;
  private $clearBtn: JQuery;
  private $typeFilter: JQuery;
  private $statusFilter: JQuery;
  private $resultsInfo: JQuery | null = null;

  private currentFilters: FilterOptions = {
    searchTerm: '',
    type: '',
    status: '',
  };

  private onFilterChange: (filters: FilterOptions) => void;

  constructor(onFilterChange: (filters: FilterOptions) => void) {
    this.$searchInput = $('#var-system-function-search');
    this.$clearBtn = $('#var-system-clear-search');
    this.$typeFilter = $('#var-system-type-filter');
    this.$statusFilter = $('#var-system-status-filter');
    this.onFilterChange = onFilterChange;

    this.bindEvents();
  }

  /**
   * 绑定事件
   */
  private bindEvents() {
    // 搜索输入
    this.$searchInput.on('input', () => {
      const value = this.$searchInput.val() as string;
      this.currentFilters.searchTerm = value.trim().toLowerCase();
      this.updateClearButton();
      this.applyFilters();
    });

    // 清除搜索按钮
    this.$clearBtn.on('click', () => {
      this.$searchInput.val('');
      this.currentFilters.searchTerm = '';
      this.updateClearButton();
      this.applyFilters();
      this.$searchInput.focus();
    });

    // 类型过滤
    this.$typeFilter.on('change', () => {
      this.currentFilters.type = this.$typeFilter.val() as string;
      this.applyFilters();
    });

    // 状态过滤
    this.$statusFilter.on('change', () => {
      this.currentFilters.status = this.$statusFilter.val() as string;
      this.applyFilters();
    });
  }

  /**
   * 更新清除按钮显示状态
   */
  private updateClearButton() {
    if (this.currentFilters.searchTerm) {
      this.$clearBtn.fadeIn(150);
    } else {
      this.$clearBtn.fadeOut(150);
    }
  }

  /**
   * 应用过滤器
   */
  private applyFilters() {
    this.onFilterChange(this.currentFilters);
  }

  /**
   * 获取当前过滤器
   */
  getFilters(): FilterOptions {
    return { ...this.currentFilters };
  }

  /**
   * 显示搜索结果信息
   * @param total 总数
   * @param visible 可见数量
   */
  showResultsInfo(total: number, visible: number) {
    const hasFilter =
      this.currentFilters.searchTerm ||
      this.currentFilters.type ||
      this.currentFilters.status;

    if (!hasFilter || visible === total) {
      this.hideResultsInfo();
      return;
    }

    if (!this.$resultsInfo) {
      this.$resultsInfo = $('<div class="var-system-search-results-info"></div>');
      this.$resultsInfo.insertBefore('#var-system-function-list');
    }

    let message = `显示 <strong>${visible}</strong> / ${total} 个函数`;

    if (this.currentFilters.searchTerm) {
      message += `，搜索: "${this.currentFilters.searchTerm}"`;
    }
    if (this.currentFilters.type) {
      const typeText = this.currentFilters.type === 'active' ? '主动函数' : '被动函数';
      message += `，类型: ${typeText}`;
    }
    if (this.currentFilters.status) {
      const statusMap: Record<string, string> = {
        enabled: '已启用',
        disabled: '已禁用',
        builtin: '内置',
      };
      message += `，状态: ${statusMap[this.currentFilters.status]}`;
    }

    this.$resultsInfo.html(message);
    this.$resultsInfo.show();
  }

  /**
   * 隐藏搜索结果信息
   */
  hideResultsInfo() {
    if (this.$resultsInfo) {
      this.$resultsInfo.hide();
    }
  }

  /**
   * 重置过滤器
   */
  reset() {
    this.$searchInput.val('');
    this.$typeFilter.val('');
    this.$statusFilter.val('');
    this.currentFilters = {
      searchTerm: '',
      type: '',
      status: '',
    };
    this.updateClearButton();
    this.hideResultsInfo();
  }
}

/**
 * 过滤函数卡片
 * @param $cards 所有卡片元素
 * @param filters 过滤条件
 */
export function filterFunctionCards($cards: JQuery, filters: FilterOptions): {
  visible: number;
  hidden: number;
} {
  let visibleCount = 0;
  let hiddenCount = 0;

  $cards.each((_, card) => {
    const $card = $(card);
    const name = $card.find('.var-system-function-name').text().toLowerCase();
    const desc = $card.find('.var-system-function-description').text().toLowerCase();
    const type = $card.data('function-type') as string;
    const enabled = $card.find('.function-enabled-checkbox').is(':checked');
    const builtin = $card.data('builtin') === true;

    // 搜索条件
    const matchSearch =
      !filters.searchTerm ||
      name.includes(filters.searchTerm) ||
      desc.includes(filters.searchTerm);

    // 类型条件
    const matchType = !filters.type || type === filters.type;

    // 状态条件
    let matchStatus = true;
    if (filters.status) {
      if (filters.status === 'enabled') {
        matchStatus = enabled;
      } else if (filters.status === 'disabled') {
        matchStatus = !enabled;
      } else if (filters.status === 'builtin') {
        matchStatus = builtin;
      }
    }

    // 综合判断
    const shouldShow = matchSearch && matchType && matchStatus;

    if (shouldShow) {
      // 使用 jQuery 动画显示
      if ($card.is(':hidden')) {
        $card.css({ opacity: 0, display: 'block' }).animate({ opacity: 1 }, 300);
      }
      visibleCount++;
    } else {
      // 使用 jQuery 动画隐藏
      if ($card.is(':visible')) {
        $card.animate({ opacity: 0 }, 200, function () {
          $(this).hide();
        });
      }
      hiddenCount++;
    }
  });

  return { visible: visibleCount, hidden: hiddenCount };
}

/**
 * 显示无结果提示
 */
export function showNoResults() {
  const $noResults = $('<div class="var-system-no-results"></div>');
  $noResults.html(`
    <i class="fa-solid fa-search"></i>
    <p>没有找到匹配的函数</p>
    <p class="var-system-hint">尝试调整搜索条件或过滤器</p>
  `);
  $('#var-system-function-list').append($noResults);
}

/**
 * 移除无结果提示
 */
export function hideNoResults() {
  $('.var-system-no-results').remove();
}
