const fs = require('fs');
const path = require('path');

describe('project structure', () => {
  test('declares and provides every mini program page', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'app.json'), 'utf8'));
    const expectedPages = [
      'pages/current/index',
      'pages/onboarding/index',
      'pages/employer/create/index',
      'pages/employer/waiting/index',
      'pages/employee/join/index',
      'pages/history/index',
      'pages/settlement/index',
      'pages/backfill/index',
      'pages/termination/index',
      'pages/settlement-status/index',
      'pages/cooperation-ended/index'
    ];
    expect(app.pages).toEqual(expectedPages);
    expect(app.pages[0]).toBe('pages/current/index');
    for (const page of expectedPages) {
      for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
        const file = path.join(__dirname, '..', 'miniprogram', `${page}${extension}`);
        expect({ file, exists: fs.existsSync(file) }).toEqual({ file, exists: true });
      }
    }
  });

  test('uses the production AppID, mini program root, cloud root, and cloud environment', () => {
    const project = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'project.config.json'), 'utf8'));
    expect(project.appid).toBe('wx56fd09f940f30024');
    expect(project.miniprogramRoot).toBe('miniprogram/');
    expect(project.cloudfunctionRoot).toBe('cloudfunctions/');
    const runtime = require('../miniprogram/config/runtime');
    expect(runtime.mode).toBe('cloud');
    expect(runtime.cloudEnv).toBe('aunt-attendance-prod-d3aa5daba41');
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(packageJson.scripts.verify).toContain('sync:shared');
    expect(packageJson.scripts.verify).toContain('jest --runInBand');
  });

  test('uses a custom bottom tabBar with larger text and a center divider', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'app.json'), 'utf8'));
    expect(app.tabBar).toMatchObject({
      custom: true,
      color: '#756E63',
      selectedColor: '#22262D',
      backgroundColor: '#FFFFFF',
      borderStyle: 'black'
    });
    expect(app.tabBar.list.map((item) => item.text)).toEqual(['当期', '历史']);
    expect(app.tabBar.list.map((item) => item.pagePath)).toEqual(['pages/current/index', 'pages/history/index']);
    const tabBarWxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'custom-tab-bar', 'index.wxml'), 'utf8');
    const tabBarWxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'custom-tab-bar', 'index.wxss'), 'utf8');
    const tabBarJs = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'custom-tab-bar', 'index.js'), 'utf8');
    const currentJs = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'current', 'index.js'), 'utf8');
    const historyJs = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'history', 'index.js'), 'utf8');
    expect(tabBarWxml).toContain('tab-item-divider');
    expect(tabBarWxml).toContain('tab-inner');
    expect(tabBarJs).toContain("text: '当期'");
    expect(currentJs).toContain('getTabBar');
    expect(historyJs).toContain('getTabBar');
    expect(tabBarWxss).toContain('font-size: 34rpx');
    expect(tabBarWxss).toContain('border-left: 2rpx solid');
    expect(tabBarWxss).toContain('bottom: 0');
    expect(tabBarWxss).toContain('box-sizing: border-box');
    expect(tabBarWxss).toContain('padding-bottom: env(safe-area-inset-bottom)');
    expect(tabBarWxss).toContain('height: 96rpx');
    expect(tabBarWxss).toContain('width: 100%');
  });

  test('uses one system font family and a constrained type-weight scale', () => {
    const rootDirectory = path.join(__dirname, '..', 'miniprogram');
    const styles = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const current = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(current);
        if (entry.isFile() && entry.name.endsWith('.wxss')) {
          styles.push(fs.readFileSync(current, 'utf8'));
        }
      }
    };
    walk(rootDirectory);
    const weights = styles.flatMap((style) => style.match(/font-weight:\s*(\d+)/g) || [])
      .map((item) => item.match(/(\d+)$/)[1]);
    const families = styles.flatMap((style) => style.match(/font-family:\s*([^;]+);/g) || []);
    const sizes = styles.flatMap((style) => style.match(/font-size:\s*(\d+)rpx/g) || [])
      .map((item) => item.match(/(\d+)rpx$/)[1]);
    expect(new Set(sizes)).toEqual(new Set(['24', '26', '28', '30', '32', '34', '38', '40', '42', '44', '48', '72']));
    expect(new Set(weights)).toEqual(new Set(['400', '600', '700']));
    expect(families).toHaveLength(1);
    expect(families[0]).toContain('-apple-system');
    expect(families[0]).toContain('PingFang SC');
  });

  test('keeps standard action-button typography and centering consistent', () => {
    const appWxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'app.wxss'), 'utf8');
    const joinWxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'employee', 'join', 'index.wxss'), 'utf8');
    const waitingWxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'employer', 'waiting', 'index.wxss'), 'utf8');
    const currentWxss = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'current', 'index.wxss'), 'utf8');
    for (const stylesheet of [appWxss, currentWxss]) {
      expect(stylesheet).toContain('align-items: center');
      expect(stylesheet).toContain('justify-content: center');
      expect(stylesheet).toContain('font-size: 34rpx');
      expect(stylesheet).toContain('font-weight: 700');
    }
    expect(appWxss).toContain('.button,');
    expect(appWxss).toContain('.button-primary,');
    expect(appWxss).toContain('.button-plain {');
    expect(joinWxss).toContain('.restart-button {');
    expect(waitingWxss).toContain('.restart-button {');
  });

  test('renders the compact overview, large calendar, and settlement explanation', () => {
    const read = (page, extension) =>
      fs.readFileSync(path.join(__dirname, '..', 'miniprogram', `${page}${extension}`), 'utf8');
    const currentWxml = read('pages/current/index', '.wxml');
    const currentWxss = read('pages/current/index', '.wxss');
    const currentJs = read('pages/current/index', '.js');
    const currentJson = JSON.parse(read('pages/current/index', '.json'));
    const settlementWxml = read('pages/settlement/index', '.wxml');
    const settlementJs = read('pages/settlement/index', '.js');
    const settlementWxss = read('pages/settlement/index', '.wxss');
    const settlementStatusWxml = read('pages/settlement-status/index', '.wxml');
    const settlementStatusJs = read('pages/settlement-status/index', '.js');
    const historyWxml = read('pages/history/index', '.wxml');
    const historyJs = read('pages/history/index', '.js');
    const historyWxss = read('pages/history/index', '.wxss');

    expect(currentWxml).toContain('stage-summary-card');
    expect(currentWxml).toContain('stage-leading');
    expect(currentWxml).toContain('auxiliary-icon');
    expect(currentWxml).toContain('summary-metrics');
    expect(currentWxml).toContain('metric-primary');
    expect(currentWxml).toContain('today-status');
    expect(currentWxml).toContain('checkin-face');
    expect(currentWxml).toContain('checkin-done');
    expect(currentWxml).toContain('{{todayClockText}} 打卡');
    expect(currentWxml).not.toContain('打卡时间');
    expect(currentWxml).toContain('今日未打卡');
    expect(currentWxml.indexOf('wx:if="{{state.today.checkedIn}}"'))
      .toBeLessThan(currentWxml.indexOf('class="calendar-panel"'));
    expect(currentWxml).toContain('bindtap="checkin"');
    expect(currentWxml).toContain('checkingIn');
    expect(currentWxml).toContain('bottom-action-bar');
    expect(currentWxml).toContain('wx:if="{{role === \'employee\'}}"');
    expect(currentWxml).toContain('wx:elif="{{role === \'employer\'}}"');
    expect(currentWxml).toContain("bindtap=\"goSettlement\"");
    expect(currentWxml).toContain("bindtap=\"goBackfill\"");
    expect(currentWxml).toContain("bindtap=\"goTermination\"");
    expect(currentWxml).toContain('bottom-settlement-button');
    expect(currentWxml).toContain('bottomCheckinText');
    expect(currentWxml).toContain('bottomCheckinDisabled');
    expect(currentWxml).toContain('face-row');
    expect(currentWxml).toContain('muted-face');
    expect(currentWxml.indexOf('class="calendar-panel"'))
      .toBeLessThan(currentWxml.indexOf('class="bottom-action-bar"'));
    expect(currentJs).toContain('checkingIn: false');
    expect(currentJs).toContain('locationPermissionDenied');
    expect(currentJs).toContain('wx.openSetting');
    expect(currentWxml).toContain('openLocationSetting');
    expect(currentJs).toContain('bottomCheckinText: \'\'');
    expect(currentJs).toContain('bottomCheckinDisabled: false');
    expect(currentJs).toContain('已打卡');
    expect(currentJs).toContain('待确认结算');
    expect(currentWxml).toContain('bindtap="goSettlement"');
    expect(currentWxml).not.toContain('flat-action-button');
    expect(currentWxml).toContain('{{totalPaidCompactText}}');
    expect(currentWxml).toContain('累计支付 {{state.lifetimeSummary.settledStages}} 期');
    expect(currentWxml).toContain('cumulativeWorkText');
    expect(currentWxml).not.toContain('quick-links');
    expect(currentWxml).toContain('auxiliary-panel');
    expect(currentWxml).not.toContain('checkin-section');
    expect(currentWxml).not.toContain('employer-action');
    expect(currentWxml).toContain('本期已上工');
    expect(currentWxml).not.toContain('本期已上工天数');
    expect(currentWxml.indexOf('class="metric-label"'))
      .toBeGreaterThan(currentWxml.indexOf('class="metric-value-row"'));
    expect(currentWxml).toContain('metric-divider');
    expect(currentJs).toContain('formatCompactDateWithYear');
    expect(currentJs).toContain('formatCompactDateWithYear');
    expect(currentJs).toContain('未开始');
    expect(currentWxml).not.toContain('checkinButtonText');
    expect(currentWxml).not.toContain('pending-card');
    expect(currentWxml).not.toContain('等待阿姨确认收款');
    expect(currentWxml).not.toContain('雇主已结算，请确认');
    expect(currentJs).not.toContain('checkinButtonText');
    expect(currentWxss).toContain('flex: 0 0 auto');
    expect(currentWxss).toContain('padding-bottom: 20rpx');
    expect(currentWxss).toContain('height: calc(100vh');
    expect(currentWxss).toContain('min-height: 0');
    expect(currentWxss).toContain('overflow: hidden');
    expect(currentJson.enablePullDownRefresh).toBe(false);
    expect(currentWxss).toContain('white-space: nowrap');
    expect(currentWxss.indexOf('.bottom-checkin-button')).toBeLessThan(
      currentWxss.indexOf('white-space: nowrap', currentWxss.indexOf('.bottom-checkin-button'))
    );
    expect(currentWxss).toContain('align-items: stretch');
    expect(currentWxss).toContain('height: 164rpx');
    expect(currentWxss).toContain('height: 84rpx');
    expect(currentWxss).toContain('height: 58rpx');
    expect(currentWxss).toContain('width: 88rpx');
    expect(currentWxss).toContain('.metric-value.amount');
    expect(currentWxss).toContain('height: 88rpx');
    expect(currentWxss).toContain('min-height: 104rpx');
    expect(currentWxss).toContain('.bottom-settlement-button');
    expect(currentWxss).toContain('.face-row');
    expect(currentWxss).toContain('.muted-face');
    expect(currentWxss).not.toContain('height: 100%');
    expect(currentWxml).not.toContain('calendar-controls');
    expect(currentWxml).toContain('calendar-header');
    expect(currentWxml).toContain('calendar-month');
    expect(currentWxml.indexOf('calendar-arrow-prev'))
      .toBeLessThan(currentWxml.indexOf('calendar-month'));
    expect(currentWxml.indexOf('calendar-month'))
      .toBeLessThan(currentWxml.indexOf('calendar-arrow-next'));
    expect(currentWxss).not.toContain('min-height: 620rpx');
    expect(currentWxml).toContain('day-dot');
    expect(currentWxml).toContain('day-time');
    expect(currentWxss).toContain('padding-top: 2rpx');
    expect(currentWxss).toContain('width: 62rpx');
    expect(currentWxss).toContain('height: 62rpx');
    expect(currentWxss).toContain('top: 4rpx');
    expect(currentWxss).toContain('right: 10rpx');
    expect(currentWxml).toContain("day.settled ? 'settled' : ''");
    expect(currentWxml).toContain("day.withinStage ? '' : 'outside'");
    expect(currentWxml).not.toContain('legend-item');
    expect(currentWxss).toContain('.day-cell.settled');
    expect(currentWxml).toContain("canPrevMonth ? '' : 'disabled'");
    expect(currentWxml).toContain("canNextMonth ? '' : 'disabled'");
    expect(currentWxml).not.toContain('未结预计');
    expect(currentJs).toContain('getCalendarNavigation');
    expect(currentJs).toContain('settledCheckinDates');
    expect(currentJs).toContain('goSettlement');
    expect(currentJs).toContain('wx.navigateTo');
    expect(settlementWxml).toContain('合同口径');
    expect(settlementWxml).toContain('本期计算');
    expect(settlementJs).toContain('wx.chooseMedia');
    expect(settlementJs).not.toContain('wx.chooseImage');
    expect(settlementJs).toContain('wx.showModal');
    expect(settlementJs).toContain('confirmSettlement');
    expect(settlementWxss).toContain('padding: 30rpx');
    expect(settlementWxss).toContain('border-radius: 32rpx');
    expect(settlementWxss).toContain('.fact-row > view');
    expect(settlementWxss).not.toContain('width: 156rpx');
    expect(settlementWxml).toContain('转账截图（必填，{{images.length}}/3）');
    expect(settlementWxml).toContain('catchtap="removeImage"');
    expect(settlementWxml).toContain('class="add-image"');
    expect(settlementWxml).not.toContain('<button wx:if="{{images.length < 3}}"');
    expect(settlementWxss).toContain('width: 192rpx');
    expect(settlementWxss).toContain('height: 192rpx');
    expect(settlementWxss).toContain('flex: 0 0 calc((100% - 32rpx) / 3)');
    expect(settlementJs).toContain('/pages/settlement-status/index');
    expect(settlementStatusWxml).toContain('bindtap="confirmSettlement"');
    expect(settlementStatusWxml).toContain('bindtap="disputeSettlement"');
    expect(settlementStatusWxml).toContain('bindtap="cancelSettlement"');
    expect(settlementStatusJs).toContain('confirmSettlementRequest');
    expect(settlementStatusWxml).toContain('nextStageStartText');
    expect(settlementStatusJs).toContain('nextStageStartText');
    expect(settlementWxss).not.toContain('right: -12rpx');
    expect(settlementWxss).not.toContain('top: -12rpx');
    expect(historyWxml).toContain('合同信息');
    expect(historyWxml).toContain('平均到岗');
    expect(historyWxml).toContain('history-tabs');
    expect(historyWxml).toContain('当前');
    expect(historyWxml).toContain('contract-group');
    expect(historyWxml).toContain('累计干了');
    expect(historyJs).toContain('USER_NOT_FOUND');
    expect(historyWxml).toContain('结算工资');
    expect(historyWxml).toContain('bindtap="toggleContractInfo"');
    expect(historyWxml).toContain('data-settlement-id');
    expect(historyJs).toContain('findSettlementProofs');
    expect(historyWxss).toContain('height: 88rpx');
    expect(historyWxss).toContain('.history-tabs');
    expect(historyWxss).toContain('.history-tab.active');
    expect(historyWxss).toContain('.contract-toggle-icon');
    expect(historyWxss).toContain('.status-pill');
    expect(historyWxml).toContain('class="info-row"');
    expect(historyWxml).toContain('contract.dailySalaryText}} / 天');
    expect(historyWxss).not.toContain('.info-grid');
    expect(historyWxss).toContain('border-radius: 32rpx');
    expect(historyWxss).toContain('width: 94rpx');
  });

  test('provides employer backfill and termination safety flows', () => {
    const read = (page, extension) =>
      fs.readFileSync(path.join(__dirname, '..', 'miniprogram', `pages/${page}${extension}`), 'utf8');
    const backfillWxml = read('backfill/index', '.wxml');
    const backfillJs = read('backfill/index', '.js');
    const backfillWxss = read('backfill/index', '.wxss');
    const terminationWxml = read('termination/index', '.wxml');
    const terminationJs = read('termination/index', '.js');
    const terminationWxss = read('termination/index', '.wxss');

    expect(backfillWxml).toContain('最近30天');
    expect(backfillWxml).toContain('连续日期');
    expect(backfillWxml).toContain('单日修改');
    expect(backfillJs).toContain("'前期补录'");
    expect(backfillWxml).toContain('bindtap="selectDay"');
    expect(backfillJs).toContain('createBackfillCheckins');
    expect(backfillJs).toContain("workTime: '09:00'");
    expect(backfillWxml).toContain('backfill-footer');
    expect(backfillWxml).toContain('将补 {{selectedCount}} 天');
    expect(backfillWxss).toContain('height: 144rpx');
    expect(backfillWxss).toContain('width: 308rpx');
    expect(backfillWxss).toContain('min-height: 88rpx');
    expect(backfillWxss).toContain('padding: 28rpx');
    expect(backfillWxml).toContain('近30天暂无可补日期');
    expect(backfillWxml).not.toContain('scroll-x');
    expect(backfillWxss).toContain('.board-day.range-start');
    expect(backfillWxss).toContain('.board-day.range-end');

    expect(terminationWxml).toContain('终止后将发生什么');
    expect(terminationWxml).toContain('当前状态');
    expect(terminationWxml).toContain('终止原因');
    expect(terminationWxml).toContain('确认终止合同');
    expect(terminationJs).toContain('terminateContract');
    expect(terminationJs).toContain('这一期还有未结算天数');
    expect(terminationWxss).toContain('.termination-summary');
    expect(terminationWxss).toContain('min-height: 104rpx');
    expect(terminationWxss).toContain('border-radius: 26rpx');
  });

  test('keeps lifecycle states on dedicated pages and makes identity reselection explicit', () => {
    const read = (page, extension) =>
      fs.readFileSync(path.join(__dirname, '..', 'miniprogram', `pages/${page}${extension}`), 'utf8');
    const currentJs = read('current/index', '.js');
    const onboardingJs = read('onboarding/index', '.js');
    const terminationJs = read('termination/index', '.js');
    const endedWxml = read('cooperation-ended/index', '.wxml');
    const endedJs = read('cooperation-ended/index', '.js');

    expect(currentJs).toContain("url = '/pages/settlement-status/index'");
    expect(currentJs).toContain("url = '/pages/onboarding/index?reselect=1'");
    expect(onboardingJs).toContain('result.data.lastCooperation');
    expect(onboardingJs).toContain('this.allowReselect = options.reselect ===');
    expect(terminationJs).toContain('/pages/cooperation-ended/index');
    expect(endedWxml).toContain('重新选择身份');
    expect(endedJs).toContain('/pages/onboarding/index?reselect=1');
  });

  test('keeps the first-run matching flow consistent and in plain language', () => {
    const read = (page, extension) =>
      fs.readFileSync(path.join(__dirname, '..', 'miniprogram', `pages/${page}${extension}`), 'utf8');
    const onboardingWxml = read('onboarding/index', '.wxml');
    const onboardingWxss = read('onboarding/index', '.wxss');
    const onboardingJs = read('onboarding/index', '.js');
    const createWxml = read('employer/create/index', '.wxml');
    const createWxss = read('employer/create/index', '.wxss');
    const createJs = read('employer/create/index', '.js');
    const joinWxml = read('employee/join/index', '.wxml');
    const joinWxss = read('employee/join/index', '.wxss');
    const joinJs = read('employee/join/index', '.js');
    const waitingWxml = read('employer/waiting/index', '.wxml');
    const waitingWxss = read('employer/waiting/index', '.wxss');
    const waitingJs = read('employer/waiting/index', '.js');
    const currentJs = read('current/index', '.js');

    expect(onboardingWxml).toContain('flow-page');
    expect(onboardingWxml).toContain('我是雇主');
    expect(onboardingWxml).toContain('我是阿姨');
    expect(onboardingWxml).not.toContain('flow-kicker');
    expect(onboardingWxml).not.toContain('flow-title');
    expect(onboardingWxml).not.toContain('flow-lead');
    expect(onboardingWxml).not.toContain('role-desc');
    expect(onboardingWxml).not.toContain('debug');
    expect(onboardingJs).toContain('restoreExistingFlow');
    expect(onboardingJs).toContain('allowReselect');
    expect(currentJs).toContain('routeFromState');
    expect(currentJs).toContain('USER_NOT_FOUND');

    for (const markup of [createWxml, joinWxml]) {
      expect(markup).toContain('flow-page');
      expect(markup).toContain('flow-title');
      expect(markup).toContain('flow-lead');
      expect(markup).not.toContain('flow-kicker');
      expect(markup).not.toContain('邀请码');
    }
    expect(createWxml).toContain("'创建合作'");
    expect(JSON.parse(read('employer/create/index', '.json')).navigationBarTitleText).toBe('创建合作');
    expect(createWxml).not.toContain('创建合作并生成匹配码');
    expect(createWxml).not.toContain('coordinate-row');
    expect(createWxml).not.toContain('placeholder="纬度"');
    expect(createWxml).not.toContain('placeholder="经度"');
    expect(createWxml).toContain('保存修改');
    expect(createWxml).toContain('>总金额</label>');
    expect(createWxml).toContain('input-shell');
    expect(createWxml).toContain('input-unit');
    expect(createWxml).toContain('{{startDisplayText}}');
    expect(createWxml).toContain('slider-shell');
    expect(createWxss).toContain('width: 100%');
    expect(createWxss).toContain('white-space: nowrap');
    expect(createWxss).toContain('align-items: end');
    expect(createWxss).toContain('.input-shell');
    expect(createWxss).toContain('.slider-shell');
    expect(createJs).toContain('formatShanghaiDateInput');
    expect(createJs).toContain('updateContract');
    expect(createJs).toContain('请点击「地图选择位置」');
    expect(joinWxml).toContain('输入匹配码');
    expect(JSON.parse(read('employee/join/index', '.json')).navigationBarTitleText).toBe('输入匹配码');
    expect(joinWxml).toContain('核对合作信息');
    expect(joinWxml).toContain('确认匹配');
    expect(joinWxml).toContain('{{previewDailySalaryText}} / 天');
    expect(waitingWxml).toContain('等待阿姨接受');
    expect(waitingWxml).not.toContain('中间态');
    expect(waitingWxml).toContain('重新生成匹配码');
    expect(waitingWxml).toContain('返回修改');
    expect(waitingWxml).toContain('去阿姨端输入匹配码');
    expect(waitingWxml).toContain('重新选择身份');
    expect(waitingJs).toContain('resetUnmatchedCooperation');
    expect(waitingJs).toContain('switchMockEmployee');
    expect(waitingJs).toContain('startPolling');
    expect(waitingJs).toContain('stopPolling');
    expect(waitingJs).toContain('5000');
    expect(waitingJs).toContain('/pages/onboarding/index?reselect=1');
    expect(waitingWxml).toContain('每 5 秒自动检查匹配状态');
    expect(waitingWxss).toContain('.auto-refresh-note');
    expect(joinWxml).toContain('重新选择身份');
    expect(joinWxml).toContain('<button');
    expect(joinWxml).toContain('button-plain restart-button');
    expect(joinWxss).toContain('min-height: 92rpx');
    expect(joinWxss).toContain('white-space: nowrap');
    expect(joinWxss).toContain('border-radius: 26rpx');
    expect(joinWxss).toContain('.flow-note');
    expect(joinJs).toContain('restartIdentity');
    expect(joinJs).toContain('formatMoney');
    expect(joinJs).toContain('/pages/onboarding/index?reselect=1');
    expect(read('current/index', '.wxml')).toContain('本期已上工');
    expect(read('current/index', '.wxml')).not.toContain('本期已上工天数');

    for (const stylesheet of [onboardingWxss, createWxss, joinWxss, waitingWxss]) {
      expect(stylesheet).toContain('flow-page');
      expect(stylesheet).toContain('padding-top: 32rpx');
    }
  });

  test('page modules can resolve their service dependencies', () => {
    global.Page = (definition) => definition;
    const pages = [
      'pages/onboarding/index',
      'pages/employer/create/index',
      'pages/employer/waiting/index',
      'pages/employee/join/index',
      'pages/current/index',
      'pages/history/index',
      'pages/settlement/index',
      'pages/backfill/index',
      'pages/termination/index',
      'pages/settlement-status/index',
      'pages/cooperation-ended/index'
    ];
    for (const page of pages) {
      expect(() => require(`../miniprogram/${page}`)).not.toThrow();
    }
  });
});
