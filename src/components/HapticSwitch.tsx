import { HAPTIC_SWITCH_ID } from '../lib/haptics'

/**
 * iPhone 觸覺回饋用的隱形開關。整個 App 只放一個。
 *
 * `switch` 屬性 React 不認得，用展開的方式原樣帶到 DOM 上。
 * 不能用 display:none——那樣 label 點下去不會切換，也就不會震。
 */
export function HapticSwitch() {
  return (
    <input
      id={HAPTIC_SWITCH_ID}
      type="checkbox"
      {...{ switch: '' }}
      tabIndex={-1}
      aria-hidden="true"
      className="haptic-switch"
    />
  )
}
