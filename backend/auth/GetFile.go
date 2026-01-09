package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"time"
)

type ProgressReader struct {
	reader     io.Reader
	total      int64
	read       int64
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

type BodyFile struct {
	Url string `json:"url"`
}

func GetFile(filePath string, url string, ctx context.Context) (string, error) {
	user := BodyFile{url}
	jsonData, err := json.Marshal(user)
	resp, err := http.Post("http://85.193.85.49:3005/api/files", "application/json", bytes.NewReader(jsonData)) // "http://85.193.85.49:3005/api/files"
	if err != nil {
		return "", fmt.Errorf("Не удалось получить файл от сервера: %w", err)
	}
	startTime := time.Now()
	contentLength, err := strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
	if err != nil {
		contentLength = -1
		return "", fmt.Errorf("Не удалось получить размер файла из заголовков: %w", err)
	}

	file, err := os.Create(filePath)
	if err != nil {
		return "", fmt.Errorf("Нет вышло создать файл по пути %v: %w", filePath, err)
	}
	defer file.Close()

	// Буфер для чтения порциями
	buf := make([]byte, 32*1024) // 32 КБ
	var written int64 = 0

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := file.Write(buf[:n]); err != nil {
				return "", fmt.Errorf("Ошибка записи файла: %w", err)
			}
			written += int64(n)
			// fmt.Printf("Загружено: %d байт из %d\n", written, contentLength)
			elapsed := time.Since(startTime)
			const mb = 1024 * 1024
			readMB := float64(written) / mb
			totalMB := float64(contentLength) / mb
			if elapsed > time.Second {
				speedMBps := float64(written) / (mb * elapsed.Seconds())
				fmt.Printf("Загружено %.2f%% (%.2f МБ из %.2f МБ) со скоростью %.2f МБ/с\n",
					float64(readMB)/float64(totalMB)*100,
					readMB,
					totalMB,
					speedMBps)
				startTime = time.Now()
			}
			runtime.EventsEmit(ctx, "progress",
				map[string]interface{}{
					"percent": math.Round(float64(readMB)/float64(totalMB)*10000) / 100,
					"read":    math.Round(readMB*100) / 100,
					"total":   math.Round(totalMB*100) / 100,
				})
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", fmt.Errorf("Ошибка чтения данных: %w", err)
		}
	}

	return "", nil
}

/*func (a *App) GetFile(filePath string, url string) (string, error) {
user := BodyFile{url}
jsonData, err := json.Marshal(user)
resp, err := http.Post("/api/files", "application/json", bytes.NewReader(jsonData)) // "/api/files"
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
}*/
