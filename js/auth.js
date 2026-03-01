/**
 * CHA 경영학전공 — 인증 · 세션 · 아바타 연동 · 체류시간 추적
 * 
 * 미컴(mediacom) auth.js 구조를 경영학용으로 수정
 * - API_BASE: business-api
 * - 키 접두사: business_
 * - 로그인 모달: 다크테마 (#login-modal)
 * - User Top Bar: #user-top-bar, #user-badge, #logout-btn
 * - MBTI T/F 제거 (경영학에는 없음)
 */

const AUTH_CONFIG = {
  API_BASE: 'https://aiforalab.com/business-api/api.php',
  TOKEN_KEY: 'business_token',
  USER_KEY: 'business_user',
  SESSION_KEY: 'business_session',
  TOKEN_EXPIRY_DAYS: 7,
};

// ─── AuthManager ───
const AuthManager = {
  _user: null,
  _token: null,
  _sessionId: null,
  _sectionTimes: {},
  _sectionTimers: {},
  _pendingSectionData: [],

  // ════════════════════════════════════
  // 초기화 — 페이지 로드 시 호출
  // ════════════════════════════════════
  init: function() {
    console.log('🔐 AuthManager init (경영학)');

    // 저장된 토큰/사용자 복원 시도
    var savedToken = localStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
    var savedUser = localStorage.getItem(AUTH_CONFIG.USER_KEY);

    if (savedToken && savedUser) {
      try {
        this._token = savedToken;
        this._user = JSON.parse(savedUser);
        this._sessionId = localStorage.getItem(AUTH_CONFIG.SESSION_KEY) || this._generateSessionId();
        console.log('✅ 세션 복원:', this._user.name);

        // 토큰 검증
        this._verifyToken();
      } catch (e) {
        console.warn('⚠️ 세션 복원 실패, 로그인 필요');
        this._clearSession();
        this._showLoginModal();
      }
    } else {
      this._showLoginModal();
    }

    // 이벤트 바인딩
    this._bindEvents();
  },

  // ════════════════════════════════════
  // 토큰 검증
  // ════════════════════════════════════
  _verifyToken: function() {
    var self = this;
    fetch(AUTH_CONFIG.API_BASE + '?action=verify', {
      headers: { 'Authorization': 'Bearer ' + this._token }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        console.log('✅ 토큰 유효');
        self._onLoginSuccess();
      } else {
        console.warn('⚠️ 토큰 만료');
        self._clearSession();
        self._showLoginModal();
      }
    })
    .catch(function(err) {
      console.warn('⚠️ 토큰 검증 실패 (오프라인?):', err);
      // 오프라인이어도 일단 허용
      self._onLoginSuccess();
    });
  },

  // ════════════════════════════════════
  // 이벤트 바인딩
  // ════════════════════════════════════
  _bindEvents: function() {
    var self = this;

    // 로그인 폼 제출
    var form = document.getElementById('login-form');
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        self._handleLogin();
      });
    }

    // 게스트 버튼
    var guestBtn = document.getElementById('login-guest-btn');
    if (guestBtn) {
      guestBtn.addEventListener('click', function() {
        self._handleGuest();
      });
    }

    // 로그아웃 버튼
    var logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        self._handleLogout();
      });
    }

    // 페이지 이탈 시 체류시간 전송
    window.addEventListener('beforeunload', function() {
      self._flushSectionTimes(true);
    });

    // visibilitychange에서도 전송
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        self._flushSectionTimes(true);
      }
    });
  },

  // ════════════════════════════════════
  // 로그인 처리
  // ════════════════════════════════════
  _handleLogin: function() {
    var self = this;
    var studentId = document.getElementById('login-student-id').value.trim();
    var name = document.getElementById('login-name').value.trim();
    var errorEl = document.getElementById('login-error');
    var submitBtn = document.querySelector('.login-submit');

    // 유효성 검사
    if (!studentId || !name) {
      errorEl.textContent = '학번과 이름을 모두 입력해주세요.';
      errorEl.style.display = 'block';
      return;
    }

    if (!/^\d{4,12}$/.test(studentId)) {
      errorEl.textContent = '학번은 4~12자리 숫자로 입력해주세요.';
      errorEl.style.display = 'block';
      return;
    }

    // 로딩 상태
    submitBtn.disabled = true;
    submitBtn.textContent = '로그인 중...';
    errorEl.style.display = 'none';

    fetch(AUTH_CONFIG.API_BASE + '?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: studentId,
        name: name
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        console.log('✅ 로그인 성공:', data.user.name);
        self._token = data.token;
        self._user = data.user;
        self._sessionId = self._generateSessionId();

        // 로컬 저장
        localStorage.setItem(AUTH_CONFIG.TOKEN_KEY, data.token);
        localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(data.user));
        localStorage.setItem(AUTH_CONFIG.SESSION_KEY, self._sessionId);

        self._onLoginSuccess();

        // 방문 로그 저장
        self._logVisit();
      } else {
        errorEl.textContent = data.error || '로그인에 실패했습니다.';
        errorEl.style.display = 'block';
      }
    })
    .catch(function(err) {
      console.warn('⚠️ 서버 연결 실패, 오프라인 로그인:', err);
      self._offlineLogin(studentId, name);
    })
    .finally(function() {
      submitBtn.disabled = false;
      submitBtn.textContent = '시작하기';
    });
  },

  // ════════════════════════════════════
  // 오프라인 로그인 (서버 연결 실패 시)
  // ════════════════════════════════════
  _offlineLogin: function(studentId, name) {
    console.log('📴 오프라인 로그인:', name);
    this._user = {
      id: 0,
      student_id: studentId,
      name: name,
      visit_count: 1
    };
    this._token = 'offline_' + Date.now();
    this._sessionId = this._generateSessionId();

    localStorage.setItem(AUTH_CONFIG.TOKEN_KEY, this._token);
    localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(this._user));
    localStorage.setItem(AUTH_CONFIG.SESSION_KEY, this._sessionId);

    this._onLoginSuccess();
  },

  // ════════════════════════════════════
  // 게스트 모드
  // ════════════════════════════════════
  _handleGuest: function() {
    console.log('👤 게스트 모드');
    this._user = {
      id: 0,
      student_id: 'guest',
      name: '게스트',
      visit_count: 0
    };
    this._token = null;
    this._sessionId = this._generateSessionId();

    this._hideLoginModal();
    this._updateUI();
    // 게스트는 DB 저장 안 함, 아바타에도 전달
    this._sendUserToAvatar();
  },

  // ════════════════════════════════════
  // 로그인 성공 후 처리
  // ════════════════════════════════════
  _onLoginSuccess: function() {
    this._hideLoginModal();
    this._updateUI();
    this._sendUserToAvatar();
    this._setupSectionTracking();
  },

  // ════════════════════════════════════
  // 로그아웃
  // ════════════════════════════════════
  _handleLogout: function() {
    console.log('🚪 로그아웃');
    this._flushSectionTimes(true);
    this._clearSession();
    this._showLoginModal();
    this._updateUI();
  },

  // ════════════════════════════════════
  // UI 업데이트
  // ════════════════════════════════════
  _updateUI: function() {
    var topBar = document.getElementById('user-top-bar');
    var badge = document.getElementById('user-badge');

    if (this._user && this._user.name) {
      // 상단바 표시
      if (topBar) topBar.classList.add('show');

      // 뱃지에 이름 표시
      if (badge) {
        var visitText = '';
        if (this._user.visit_count && this._user.visit_count > 1) {
          visitText = ' · ' + this._user.visit_count + '회 방문';
        }
        badge.textContent = this._user.name + visitText;
      }
    } else {
      if (topBar) topBar.classList.remove('show');
    }
  },

  // ════════════════════════════════════
  // 아바타에 사용자 정보 전달 (postMessage)
  // ════════════════════════════════════
  _sendUserToAvatar: function() {
    var iframe = document.getElementById('heygen-pip');
    if (!iframe || !iframe.contentWindow) {
      console.warn('⚠️ 아바타 iframe 없음');
      return;
    }

    var payload = {
      type: 'USER_INFO',
      user: this._user,
      token: this._token,
      sessionId: this._sessionId,
      apiBase: AUTH_CONFIG.API_BASE
    };

    // iframe 로드 완료 후 전송 (약간의 딜레이)
    var self = this;
    setTimeout(function() {
      try {
        iframe.contentWindow.postMessage(payload, '*');
        console.log('📤 USER_INFO 전송:', self._user ? self._user.name : 'null');
      } catch (e) {
        console.warn('⚠️ postMessage 전송 실패:', e);
      }
    }, 1000);

    // iframe이 늦게 로드될 수 있으므로 추가 전송
    setTimeout(function() {
      try {
        iframe.contentWindow.postMessage(payload, '*');
      } catch (e) { /* 무시 */ }
    }, 3000);
  },

  // ════════════════════════════════════
  // 방문 로그 저장
  // ════════════════════════════════════
  _logVisit: function() {
    if (!this._token || this._token.indexOf('offline') === 0) return;

    this.apiCall('log', 'POST', {
      url: location.href,
      user_agent: navigator.userAgent,
      referrer: document.referrer || ''
    });
  },

  // ════════════════════════════════════
  // 섹션 체류시간 추적
  // ════════════════════════════════════
  _setupSectionTracking: function() {
    var self = this;
    var sections = document.querySelectorAll('section[id]');

    if (!sections.length) return;

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        var sectionId = entry.target.id;

        if (entry.isIntersecting) {
          // 섹션 진입 → 타이머 시작
          self._sectionTimers[sectionId] = Date.now();
        } else {
          // 섹션 이탈 → 체류시간 계산
          if (self._sectionTimers[sectionId]) {
            var elapsed = Math.round((Date.now() - self._sectionTimers[sectionId]) / 1000);
            if (elapsed > 0 && elapsed < 600) { // 10분 미만만 기록
              if (!self._sectionTimes[sectionId]) {
                self._sectionTimes[sectionId] = 0;
              }
              self._sectionTimes[sectionId] += elapsed;
              self._pendingSectionData.push({
                section_id: sectionId,
                duration: elapsed
              });
            }
            delete self._sectionTimers[sectionId];
          }
        }
      });
    }, { threshold: 0.4 });

    sections.forEach(function(sec) {
      observer.observe(sec);
    });

    // 주기적 전송 (30초마다)
    setInterval(function() {
      self._flushSectionTimes(false);
    }, 30000);
  },

  // ════════════════════════════════════
  // 체류시간 배치 전송
  // ════════════════════════════════════
  _flushSectionTimes: function(force) {
    if (!this._token || this._token.indexOf('offline') === 0) return;
    if (!force && this._pendingSectionData.length < 5) return;
    if (this._pendingSectionData.length === 0) return;

    var dataToSend = this._pendingSectionData.slice();
    this._pendingSectionData = [];

    console.log('📊 체류시간 전송:', dataToSend.length + '건');

    // sendBeacon 사용 (beforeunload에서도 동작)
    if (force && navigator.sendBeacon) {
      var url = AUTH_CONFIG.API_BASE + '?action=section_time';
      var blob = new Blob([JSON.stringify({
        session_id: this._sessionId,
        sections: dataToSend
      })], { type: 'application/json' });

      navigator.sendBeacon(url, blob);
    } else {
      this.apiCall('section_time', 'POST', {
        session_id: this._sessionId,
        sections: dataToSend
      });
    }
  },

  // ════════════════════════════════════
  // API 호출 유틸리티
  // ════════════════════════════════════
  apiCall: function(action, method, data) {
    var url = AUTH_CONFIG.API_BASE + '?action=' + action;
    var options = {
      method: method || 'GET',
      headers: {}
    };

    if (this._token) {
      options.headers['Authorization'] = 'Bearer ' + this._token;
    }

    if (method === 'POST' && data) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }

    return fetch(url, options)
      .then(function(res) { return res.json(); })
      .catch(function(err) {
        console.warn('⚠️ API 호출 실패 [' + action + ']:', err);
        return { success: false, error: 'Network error' };
      });
  },

  // ════════════════════════════════════
  // 모달 제어
  // ════════════════════════════════════
  _showLoginModal: function() {
    var modal = document.getElementById('login-modal');
    if (modal) {
      modal.classList.add('active');
    }
  },

  _hideLoginModal: function() {
    var modal = document.getElementById('login-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  },

  // ════════════════════════════════════
  // 세션 관리
  // ════════════════════════════════════
  _clearSession: function() {
    this._user = null;
    this._token = null;
    this._sessionId = null;
    localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
    localStorage.removeItem(AUTH_CONFIG.USER_KEY);
    localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
  },

  _generateSessionId: function() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  }
};

// ─── 페이지 로드 시 자동 초기화 ───
document.addEventListener('DOMContentLoaded', function() {
  AuthManager.init();
});
