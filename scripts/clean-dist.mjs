import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

// dist 是完全由构建生成的目录；先清理可避免已删除源码留下陈旧发布文件。
rmSync(resolve('dist'), { recursive: true, force: true })
