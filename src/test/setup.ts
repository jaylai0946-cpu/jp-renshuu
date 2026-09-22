import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 沒有開 vitest globals，RTL 不會自動註冊 cleanup，要自己來。
afterEach(cleanup)
