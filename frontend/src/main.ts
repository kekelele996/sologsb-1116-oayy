import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from '@/App.vue'
import router from '@/router'
import { seedDemoData, stampDbVersion } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'
import { draftStore } from '@/stores/draftStore'
import { sweepExpiredLocks } from '@/concurrency/locks'
import { subscribeEvents } from '@/concurrency/bus'
import '@/styles/main.css'

async function bootstrap(): Promise<void> {
  // 上次崩溃 / 被强杀的窗口可能留下过期写锁，启动先清，保证写权自动放开
  await sweepExpiredLocks()
  await seedDemoData()
  await stampDbVersion()
  await Promise.all([
    pointStore.getState().hydrate(),
    recordStore.getState().hydrate(),
    sporeStore.getState().hydrate(),
    identifyStore.getState().hydrate(),
    draftStore.getState().hydrate()
  ])
}

// 别的窗口落库后，本窗口重新拉取，保证保存前看到的版本尽量是新的
subscribeEvents((event) => {
  if (event.type === 'data-changed') {
    switch (event.domain) {
      case 'records':
        void recordStore.getState().hydrate()
        break
      case 'spores':
        void sporeStore.getState().hydrate()
        break
      case 'points':
        void pointStore.getState().hydrate()
        break
      case 'identifies':
        void identifyStore.getState().hydrate()
        break
    }
  } else if (event.type === 'draft-changed') {
    void draftStore.getState().hydrate()
  }
})

// 兜底：心跳之外，每 10s 清一次全库过期锁
window.setInterval(() => void sweepExpiredLocks(), 10000)

const app = createApp(App)

Object.entries(ElementPlusIconsVue).forEach(([key, component]) => {
  app.component(key, component)
})

app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')

void bootstrap()
