package main

import (
	"context"
	"fmt"
	"os"
	"io"
    "log"
    "crypto/md5"
    "time"
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