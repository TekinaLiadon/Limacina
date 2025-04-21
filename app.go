package main

import (
	"context"
	"fmt"
	"os"
	"io"
    "log"
    "os/exec"
    "crypto/md5"
        "net/http"
        "encoding/json"
        "bytes"
        "path/filepath"
        "github.com/wailsapp/wails/v2/pkg/runtime"
        "strconv"
         "time"
         "math"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}


func (a *App) CheckDir() string {
    dirname, err := os.UserHomeDir()
    if err != nil {
        log.Fatal( err )
    }
    return dirname
}

func (a *App) GetFileInfo(filePath string) string {
        hash := md5.New()
        file, err := os.Open(filePath)
        if err != nil {
                return ""
        }
        defer file.Close()
        _, err = io.Copy(hash, file)
        	if err != nil {
        		panic(err)
        	}
        md5 := fmt.Sprintf("%x", hash.Sum(nil))
        return md5
}


type BodyFile struct {
    Url string `json:"url"`
}

type ProgressReader struct {
        reader io.Reader
        total   int64
        read    int64
        onProgress func(read, total int64)
}

func (pr *ProgressReader) Read(p []byte) (n int, err error) {
        n, err = pr.reader.Read(p)
        pr.read += int64(n)
        if pr.onProgress != nil {
                pr.onProgress(pr.read, pr.total)
        }
        return
}

func (a *App) GetFile(filePath string, url string) (string, error) {
user := BodyFile{url}
jsonData, err := json.Marshal(user)
resp, err := http.Post("http://85.193.85.49:3005/api/files", "application/json", bytes.NewReader(jsonData)) // "http://85.193.85.49:3005/api/files"
    if err != nil {
        fmt.Print(err)
        return "", err
    }
    startTime := time.Now()
    contentLength, err := strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
            if err != nil {
                    fmt.Println("Не удалось получить размер файла из заголовков")
                    contentLength = -1
            }
    dir := filepath.Dir(filePath)
    _, err = os.Stat(dir)
        if os.IsNotExist(err) {
            err = os.MkdirAll(dir, 0755)
            if err != nil {
                return "", err
            }
        } else if err != nil {
            return "", err
        }
    file, err := os.Create(filePath)
        if err != nil {
        fmt.Print(err)
            return "", err
        }
        defer file.Close()
        progressReader := &ProgressReader{reader: resp.Body, total: contentLength}
                progressReader.onProgress = func(read, total int64) {
                    elapsed := time.Since(startTime)
                    const mb = 1024 * 1024
                    readMB := float64(read) / mb
                    totalMB := float64(total) / mb
                    if elapsed > time.Second {
                         speedMBps := float64(read) / (mb * elapsed.Seconds())
                         fmt.Printf("Загружено %.2f%% (%.2f МБ из %.2f МБ) со скоростью %.2f МБ/с\n",
                                                    float64(readMB)/float64(totalMB)*100,
                                                    readMB,
                                                    totalMB,
                                                    speedMBps)
                                            startTime = time.Now()
                         runtime.EventsEmit(a.ctx, "progress",
                            map[string]interface{}{
                            "percent": math.Round(float64(readMB)/float64(totalMB)* 10000) / 100,
                            "read": math.Round(readMB*100) / 100,
                            "total": math.Round(totalMB*100) / 100,
                            "speed": math.Round(speedMBps*100) / 100,
                         })
                    } else {
                    runtime.EventsEmit(a.ctx, "progress",
                                                        map[string]interface{}{
                                                                "percent": math.Round(float64(readMB)/float64(totalMB)* 10000) / 100,
                                                                "read": math.Round(readMB*100) / 100,
                                                                "total": math.Round(totalMB*100) / 100,
                                                        })
                    }
                }
    _, err = io.Copy(file, progressReader)
        if err != nil {
        fmt.Print(err)
            return "", err
        }

    return "", nil
}

func (a *App) GetFileList() (string, error) {
    resp, err := http.Get("http://85.193.85.49:3005/api/list")
    if err != nil {
                    return "", err
            }
            defer resp.Body.Close()

            var result map[string]interface{}
            if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
                    return "", fmt.Errorf("не удалось декодировать JSON: %w", err)
            }

            jsonData, err := json.Marshal(result)
            if err != nil {
                    return "", fmt.Errorf("не удалось маршалировать JSON: %w", err)
            }
            var data interface{}
            if err := json.Unmarshal(jsonData, &data); err != nil {
                fmt.Println("Ошибка при чтении JSON:", err)
            }
            res := data.(map[string]interface{})
            core := a.CheckDir() + "/test/"
            sliceKey := []string{}
            for key, val := range res {
            _, err := os.Stat(core + key)
                    if os.IsNotExist(err) {
                        sliceKey = append(sliceKey, key)
                    } else {
                            hash := a.GetFileInfo(core + key)
                              if(hash == val) {
                                 continue
                              } else {
                                 sliceKey = append(sliceKey, key)
                              }
                           }

            }
            runtime.EventsEmit(a.ctx, "totalFile", len(sliceKey))
            count := 0
            for _, val := range sliceKey {
                count += 1
                runtime.EventsEmit(a.ctx, "numberFile",
                map[string]interface{}{
                        "file": filepath.Base(val),
                        "number": count,
                })
                a.GetFile(core + val, val)
            }
            return string(jsonData), nil
}

func (a *App) StartJvm() {

            args := []string{"-jar", a.CheckDir() + "/test/updates/StargazerPrologue/minecraft.jar", "-Xmx4G", "-XX:+UnlockExperimentalVMOptions", "-XX:+UseG1GC", "-XX:G1NewSizePercent=20", "-XX:G1ReservePercent=20", "-XX:MaxGCPauseMillis=50", "-XX:G1HeapRegionSize=32M", "--version", "1.16.5", "/test/updates/StargazerPrologue/minecraft.jar"}
            cmd := exec.Command("java",  args...)
                    err := cmd.Start()
                    if err != nil {
                        fmt.Println("Ошибка при запуске Minecraft:", err)
                    }
                    fmt.Println(err)

    /*
    cmd := exec.Command("java", "-jar", "minecraft.jar", "но_путь/к/серверу")
        err := cmd.Start()
        if err != nil {
            fmt.Println("Ошибка при запуске Minecraft:", err)
        } */
}

/* func CreateDir(path string) {
    dir := filepath.Dir(path)
    _, err = os.Stat(dir)
    if os.IsNotExist(err) {
       err = os.MkdirAll(dir, 0755)
       if err != nil {
         panic(err)
       }
     } else if err != nil {
       panic(err)
    }
}

func GetJson(url string) map[string]interface{} {
    resp, err := http.Get(url)
    if err != nil {
       fmt.Errorf("Ошибка: %w", err)
    }
    defer resp.Body.Close()
    var result map[string]interface{}
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
       fmt.Errorf("не удалось декодировать JSON: %w", err)
    }
    sonData, err := json.Marshal(result)
    if err != nil {
        fmt.Errorf("не удалось маршалировать JSON: %w", err)
    }
    var data interface{}
    if err := json.Unmarshal(jsonData, &data); err != nil {
        fmt.Println("Ошибка при чтении JSON:", err)
    }
    res := data.(map[string]interface{})
    return res
}

func SaveConfig(data interface{}, filePath string){
    file, err := os.Create(filePath + "/config.json")
        if err != nil {
            panic(err)
        }
        defer file.Close()

        encoder := json.NewEncoder(file)
        encoder.SetIndent("", "  ")
        err = encoder.Encode(data)
        if err != nil {
            panic(err)
        }
}

func (a *App) GetConfigInfo(url string) string {
    coreDir := a.CheckDir()
    CreateDir(coreDir + "/Lumacina")
    json := GetJson(url) // "http://localhost:3005/api/config"
    CreateDir(coreDir + "/Lumacina/" + json["name"])
    SaveConfig(coreDir + "/Lumacina")

    return json["name"]
} */


/*
cmd := exec.Command("java", "-jar", "minecraft.jar", "но_путь/к/серверу")
    err := cmd.Start()
    if err != nil {
        fmt.Println("Ошибка при запуске Minecraft:", err)
    } */
