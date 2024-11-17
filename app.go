package main

import (
	"context"
	"fmt"
	"os"
	"io"
    "log"
    "crypto/md5"
    "time"
        "net/http"
        "encoding/json"
        "bytes"
        "path/filepath"
)

// App struct
type App struct {
	ctx context.Context
}
type FileInfo struct {
        Name        string
        Size        int64
        ModTime     time.Time
        MD5Hash     string
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

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

func (a *App) CheckDir() string {
    dirname, err := os.UserHomeDir()
    if err != nil {
        log.Fatal( err )
    }
    return dirname
}

func (a *App) GetFileInfo(filePath string) (FileInfo) {
        file, err := os.Open(filePath)
        if err != nil {
                return FileInfo{}
        }
        defer file.Close()
        fileInfo, err := file.Stat()
                if err != nil {
                        return FileInfo{}
                }

        hash := md5.New()
        if _, err := io.Copy(hash, file); err != nil {
                return FileInfo{}
        }

        return FileInfo{
                Name:        fileInfo.Name(),
                Size:        fileInfo.Size(),
                ModTime:     fileInfo.ModTime(),
                MD5Hash:     fmt.Sprintf("%x", hash.Sum(nil)),
        }
}

type BodyFile struct {
    Url string `json:"url"`
}

func (a *App) GetFile(filePath string) (string, error) {
user := BodyFile{"config/watut-client.toml"}
jsonData, err := json.Marshal(user)
resp, err := http.Post("http://localhost:3005/api/files", "application/json", bytes.NewReader(jsonData)) // "http://85.193.85.49:3005/api/files"
    if err != nil {
        fmt.Print(err)
        return "", err
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
    _, err = io.Copy(file, resp.Body)
        if err != nil {
        fmt.Print(err)
            return "", err
        }

    return "", nil
}

func (a *App) GetFileList() (string, error) {
    resp, err := http.Get("http://localhost:3005/api/list")
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

            return string(jsonData), nil
}
