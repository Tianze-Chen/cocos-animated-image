/**
 * 原生后端注册表。注册顺序即分发优先级，由 backends.ts 决定 —— 层内不写死，
 * 迁入引擎时引擎侧自己决定注册谁。
 */

import type { NativeBackendDescriptor } from './types';

const backends: NativeBackendDescriptor[] = [];

export function registerNativeBackend (backend: NativeBackendDescriptor): void {
    // 同一对象重复注册（重复 import）直接忽略，幂等。
    if (backends.indexOf(backend) < 0) {
        backends.push(backend);
    }
}

export function getNativeBackends (): readonly NativeBackendDescriptor[] {
    return backends;
}

// isTypeSupported 结果缓存：open 高频而探测结果不变，一次探测终身复用；
// 探测本身抛错也缓存为 false —— 坏的探测试一次就够，不能每个动图都挨一遍。
const supportCache = new Map<string, Promise<boolean>>();

export function probeBackendType (backend: NativeBackendDescriptor, mime: string): Promise<boolean> {
    const key = `${backend.name}::${mime}`;
    const cached = supportCache.get(key);
    if (cached) { return cached; }
    let probe: Promise<boolean> | null = null;
    try {
        probe = backend.isTypeSupported(mime);
    } catch (e) {
        probe = null;
    }
    const result = probe
        ? probe.catch((e) => {
            console.warn(`[animated-image] ${backend.name} isTypeSupported(${mime}) 探测失败，按不支持处理：${String(e)}`);
            return false;
        })
        : Promise.resolve(true); // 无法探测 = 按可尝试处理；真正的失败在 create/ready，那边有降级出口
    supportCache.set(key, result);
    return result;
}

/** 同步探测：任一后端在宿主上存在即认为原生档可用（供组件层 isNativeSupported 用）。 */
export function isAnyBackendAvailable (): boolean {
    for (const backend of backends) {
        try {
            if (backend.available()) { return true; }
        } catch (e) {
            // 探测自身抛错按不存在处理，继续看下一个。
        }
    }
    return false;
}
