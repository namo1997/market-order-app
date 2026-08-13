import AppKit
import Foundation
import Vision

for path in CommandLine.arguments.dropFirst() {
    autoreleasepool {
        guard
            let image = NSImage(contentsOfFile: path),
            let tiff = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let cgImage = bitmap.cgImage
        else {
            print("FILE\t\(path)\tERROR")
            return
        }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["th-TH", "en-US"]
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

        do {
            try handler.perform([request])
            let text = (request.results ?? [])
                .compactMap { $0.topCandidates(1).first?.string }
                .joined(separator: " | ")
                .replacingOccurrences(of: "\t", with: " ")
                .replacingOccurrences(of: "\n", with: " ")
            print("FILE\t\(path)\t\(text)")
        } catch {
            print("FILE\t\(path)\tERROR \(error)")
        }
    }
}
