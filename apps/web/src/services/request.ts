import axios from 'axios';
import { useAuthStore } from '../stores/useAuthStore';
import type { InternalAxiosRequestConfig } from 'axios';
import type { LoginResult } from './auth.api';
let refreshing: Promise<string> | null = null;
type AuthRequest = InternalAxiosRequestConfig & { _retry?: boolean; _actorId?: number };

/**
 * 统一HTTP请求封装
 * - 自动注入Bearer Token
 * - 401自动跳转登录
 * - 统一错误处理
 */
const request = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: inject JWT
request.interceptors.request.use((config) => {
  const authConfig = config as AuthRequest;
  if (!('_actorId' in authConfig)) authConfig._actorId = useAuthStore.getState().user?.id;
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: unwrap data + handle errors
request.interceptors.response.use(
  (response) => {
    const body = response.data;
    // 统一响应格式: { code: 0, data: T, message: string, meta?: object }
    if (body.code === 0) {
      return body.data !== undefined ? body.data : body;
    }
    return Promise.reject(new Error(body.message || '请求失败'));
  },
  async (error) => {
    const status = error.response?.status;
    const body = error.response?.data;

    if (status === 401 && !['/auth/login', '/auth/refresh', '/auth/dingtalk/login'].includes(error.config?.url || '')) {
      const config = error.config as AuthRequest | undefined;
      const current = useAuthStore.getState();
      if (config && config._actorId !== current.user?.id) return Promise.reject(error);
      // A delayed 401 from an older token must not rotate the just-refreshed token again.
      if (
        config &&
        !config._retry &&
        current.accessToken &&
        config.headers.Authorization !== `Bearer ${current.accessToken}`
      ) {
        config._retry = true;
        config.headers.Authorization = `Bearer ${current.accessToken}`;
        return request(config);
      }
      const oldRefresh = useAuthStore.getState().refreshToken;
      if (config && !config._retry && oldRefresh) {
        try {
          refreshing ??= axios
            .post<{ code: number; data: LoginResult }>(
              '/api/v1/auth/refresh',
              { refreshToken: oldRefresh },
              { timeout: 15000 },
            )
            .then(({ data }) => {
              if (data.code !== 0 || useAuthStore.getState().refreshToken !== oldRefresh) throw new Error('会话已更改');
              const next = data.data;
              useAuthStore.getState().setAuth(next.accessToken, next.refreshToken, next.user);
              return next.accessToken;
            })
            .finally(() => {
              refreshing = null;
            });
          const next = await refreshing;
          config._retry = true;
          config.headers.Authorization = `Bearer ${next}`;
          return request(config);
        } catch (refreshError) {
          if (config._actorId !== useAuthStore.getState().user?.id) return Promise.reject(error);
          if (axios.isAxiosError(refreshError) && ![401, 403].includes(refreshError.response?.status || 0))
            return Promise.reject(refreshError);
        }
      }
      useAuthStore.getState().logout();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    const message = body?.message || error.message || '网络异常';
    return Promise.reject({ ...error, message, code: body?.code, data: body?.data });
  },
);

export default request;
