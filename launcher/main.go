// Лаунчер приложения обработки испытаний Instron.
// Отдаёт встроенный app.html по http://127.0.0.1:<автопорт> и открывает
// окно браузера в режиме --app (без вкладок). Приложение живёт пока живо
// окно: без heartbeat ~75 с сервер завершается.
package main

import (
	_ "embed"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"
)

//go:embed app.html.gz
var appHTML []byte // gzip-содержимое app.html — браузер разожмёт сам

var lastBeat atomic.Int64
var gotBeat atomic.Bool

const (
	// ожидание первого heartbeat после старта (браузер мог не открыться)
	firstBeatTimeout = 90 * time.Second
	// допустимая пауза между heartbeat живого окна (фронт шлёт раз в 10 с)
	beatTimeout = 75 * time.Second
)

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(appHTML)
	})
	mux.HandleFunc("/api/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().Unix())
		gotBeat.Store(true)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	return mux
}

// сторож: выходим, если окно так и не открылось или было закрыто
func watchdog() {
	started := time.Now()
	for range time.Tick(5 * time.Second) {
		if !gotBeat.Load() {
			if time.Since(started) > firstBeatTimeout {
				return
			}
			continue
		}
		if time.Since(time.Unix(lastBeat.Load(), 0)) > beatTimeout {
			return
		}
	}
}

func winBrowserPaths() []string {
	pf := os.Getenv("ProgramFiles")
	pf86 := os.Getenv("ProgramFiles(x86)")
	lad := os.Getenv("LocalAppData")
	return []string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(lad, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(lad, `Google\Chrome\Application\chrome.exe`),
	}
}

// открыть url: приоритет — режим --app в Edge/Chrome, иначе браузер по умолчанию
func openBrowser(url string) bool {
	switch runtime.GOOS {
	case "windows":
		for _, p := range winBrowserPaths() {
			if _, err := os.Stat(p); err == nil {
				if exec.Command(p, "--app="+url).Start() == nil {
					return true
				}
			}
		}
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start() == nil
	case "darwin":
		return exec.Command("open", url).Start() == nil
	default: // linux и прочие unix
		for _, b := range []string{"google-chrome", "chromium", "chromium-browser", "microsoft-edge", "firefox"} {
			if p, err := exec.LookPath(b); err == nil {
				arg := "--app=" + url
				if b == "firefox" {
					arg = url // firefox не умеет --app
				}
				if exec.Command(p, arg).Start() == nil {
					return true
				}
			}
		}
		return exec.Command("xdg-open", url).Start() == nil
	}
}

func main() {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, "не удалось открыть порт:", err)
		os.Exit(1)
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)

	srv := &http.Server{Handler: handler()}
	go srv.Serve(ln)

	if !openBrowser(url) {
		fmt.Println("Не удалось открыть браузер автоматически. Откройте вручную:", url)
	}

	// ждём первый heartbeat либо тишину окна — потом выходим
	go func() {
		watchdog()
		srv.Close()
		os.Exit(0)
	}()

	// держим процесс живым; watchdog сам завершит
	select {}
}
