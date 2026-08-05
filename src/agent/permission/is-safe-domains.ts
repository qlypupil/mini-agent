/**
 * Common domains used by developers in China.
 * Network tools may use this list for automatic approval, but listed content is not trusted.
 */
export const commonDomainsCNForDevelopers = [
	// Search, source hosting, and developer communities.
	'baidu.com',
	'bing.com',
	'google.com',
	'github.com',
	'gitee.com',
	'gitlab.com',
	'gitcode.com',
	'coding.net',
	'atomgit.com',
	'csdn.net',
	'cnblogs.com',
	'juejin.cn',
	'segmentfault.com',
	'oschina.net',
	'51cto.com',
	'infoq.cn',
	'v2ex.com',
	'zhihu.com',
	'stackoverflow.com',
	'leetcode.cn',
	'nowcoder.com',
	'runoob.com',
	'bilibili.com',
	'geekbang.org',

	// Packages, languages, frameworks, and documentation.
	'npmjs.com',
	'npmmirror.com',
	'pypi.org',
	'mvnrepository.com',
	'nuget.org',
	'crates.io',
	'docker.com',
	'docker.io',
	'githubusercontent.com',
	'jsdelivr.net',
	'microsoft.com',
	'visualstudio.com',
	'jetbrains.com',
	'nodejs.org',
	'python.org',
	'openjdk.org',
	'oracle.com',
	'spring.io',
	'go.dev',
	'rust-lang.org',
	'react.dev',
	'vuejs.org',
	'typescriptlang.org',
	'mozilla.org',
	'apache.org',
	'dcloud.net',
	'nginx.org',
	'vite.dev',

	// Cloud, infrastructure, databases, and API tools.
	'aliyun.com',
	'tencentcloud.com',
	'huaweicloud.com',
	'volcengine.com',
	'qiniu.com',
	'amazonaws.com',
	'azure.com',
	'cloudflare.com',
	'kubernetes.io',
	'helm.sh',
	'hashicorp.com',
	'jenkins.io',
	'grafana.com',
	'prometheus.io',
	'elastic.co',
	'mysql.com',
	'postgresql.org',
	'redis.io',
	'mongodb.com',
	'sqlite.org',
	'postman.com',
	'apifox.com',
	'apipost.cn',
	'swagger.io',
	'vercel.com',

	// Collaboration and productivity.
	'feishu.cn',
	'dingtalk.com',
	'qq.com',
	'yuque.com',
	'tapd.cn',
	'pingcode.com',
	'ones.cn',
	'notion.so',
	'office.com',
	'atlassian.com',
	'wps.cn',

	// AI platforms and coding assistants.
	'deepseek.com',
	'moonshot.cn',
	'doubao.com',
	'qwen.ai',
	'bigmodel.cn',
	'modelscope.cn',
	'siliconflow.cn',
	'openai.com',
	'anthropic.com',
	'huggingface.co',
	'cursor.com',
	'trae.ai',
] as const

const safeDomains = new Set<string>(commonDomainsCNForDevelopers)

function normalizeHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/\.$/, '')
}

/**
 * Returns whether an HTTP(S) URL targets a listed domain or one of its subdomains.
 */
export function isSafeDomain(value: string): boolean {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		return false
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return false
	}

	const hostname = normalizeHostname(url.hostname)
	if (!hostname) return false

	if (safeDomains.has(hostname)) return true

	for (const domain of safeDomains) {
		if (hostname.endsWith(`.${domain}`)) return true
	}

	return false
}
